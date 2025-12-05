import {
  Client,
  GatewayIntentBits,
  Partials,
  Routes,
  REST,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

import dotenv from "dotenv";
import fs from "fs-extra";
dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel]
});

const token = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

const DB = "./deals.json";
await fs.ensureFile(DB);
let data = await fs.readJSON(DB).catch(() => ({ nextId: 1, deals: [] }));

function saveDB() {
  return fs.writeJSON(DB, data, { spaces: 2 });
}

const commands = [
  new SlashCommandBuilder()
    .setName("setup_mm")
    .setDescription("Create the Middleman request panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("completed")
    .setDescription("Mark deal as completed (Middleman Only)")
    .addIntegerOption(o =>
      o.setName("dealid").setDescription("Deal ID number").setRequired(true)
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

client.on("ready", async () => {
  console.log(`MM Bot logged in as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    try {
      await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: commands });
      console.log(`Commands registered for guild: ${guild.name}`);
    } catch (err) {
      console.error(`Failed to register commands for ${guild.name}:`, err);
    }
  }
});

client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "setup_mm") {
      const embed = new EmbedBuilder()
        .setTitle("🛡 Middleman Services")
        .setDescription("Need a trusted middleman for your trade?\n\nClick the button below to request a middleman. You'll be asked to provide:\n• The person you're trading with\n• What you're trading\n• The price/offer")
        .setColor("Orange");
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("request_mm")
          .setLabel("🛡 Request Middleman")
          .setStyle(ButtonStyle.Primary)
      );
      await interaction.reply({ embeds: [embed], components: [row] });
    }
    if (interaction.commandName === "completed") {
      const id = interaction.options.getInteger("dealid");
      let deal = data.deals.find(d => d.id === id);
      if (!deal) return interaction.reply({ content: "Deal not found!", ephemeral: true });
      if (deal.mm !== interaction.user.id)
        return interaction.reply({ content: "Only the assigned Middleman can complete this deal.", ephemeral: true });
      deal.status = "completed";
      await saveDB();
      const completedCh = interaction.guild.channels.cache.find(c => c.name === "completed-deals");
      if (completedCh)
        completedCh.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(`✅ Deal #${id} Completed`)
              .addFields(
                { name: "Buyer", value: `<@${deal.buyer}>` },
                { name: "Seller", value: `<@${deal.seller}>` },
                { name: "Middleman", value: `<@${deal.mm}>` },
                { name: "Item", value: deal.item },
                { name: "Price", value: deal.price }
              )
              .setColor("Green")
          ]
        });
      return interaction.reply({ content: `Marked deal #${id} as completed.`, ephemeral: true });
    }
  }
  if (interaction.isButton()) {
    if (interaction.customId === "request_mm") {
      const modal = new ModalBuilder().setCustomId("mm_form").setTitle("Request a Middleman");
      const traderInput = new TextInputBuilder()
        .setCustomId("trader_id")
        .setLabel("Trader's Discord ID or @mention")
        .setPlaceholder("e.g. 123456789012345678 or @username")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const itemInput = new TextInputBuilder()
        .setCustomId("item")
        .setLabel("What are you trading?")
        .setPlaceholder("e.g. Roblox Account, Game Items, etc.")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const priceInput = new TextInputBuilder()
        .setCustomId("price")
        .setLabel("Price / Offer")
        .setPlaceholder("e.g. $50, 100 Robux, etc.")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      modal.addComponents(
        new ActionRowBuilder().addComponents(traderInput),
        new ActionRowBuilder().addComponents(itemInput),
        new ActionRowBuilder().addComponents(priceInput)
      );
      await interaction.showModal(modal);
    }
    if (interaction.customId.startsWith("claim_")) {
      const id = parseInt(interaction.customId.split("_")[1]);
      let deal = data.deals.find(d => d.id === id);
      if (!deal) return interaction.reply({ content: "Deal not found!", ephemeral: true });
      if (deal.mm) return interaction.reply({ content: "Deal already claimed!", ephemeral: true });
      deal.mm = interaction.user.id;
      deal.status = "active";
      await saveDB();
      const ch = await interaction.guild.channels.create({
        name: `deal-${id}`,
        type: 0,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: deal.buyer, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: deal.seller, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: deal.mm, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] }
        ]
      });
      deal.channel = ch.id;
      await saveDB();
      const embed = new EmbedBuilder()
        .setTitle(`🔐 Deal #${id} Active`)
        .setDescription("Private deal room created. Complete your trade here!")
        .addFields(
          { name: "Buyer", value: `<@${deal.buyer}>` },
          { name: "Seller", value: `<@${deal.seller}>` },
          { name: "Middleman", value: `<@${deal.mm}>` },
          { name: "Item", value: deal.item },
          { name: "Price", value: deal.price }
        )
        .setFooter({ text: `When complete, MM uses /completed ${id}` })
        .setColor("Blue");
      await ch.send({ content: `<@${deal.buyer}> <@${deal.seller}> <@${deal.mm}>`, embeds: [embed] });
      return interaction.update({ content: `Deal #${id} claimed by <@${deal.mm}>`, components: [] });
    }
  }
  if (interaction.isModalSubmit()) {
    if (interaction.customId === "mm_form") {
      const traderInput = interaction.fields.getTextInputValue("trader_id");
      const item = interaction.fields.getTextInputValue("item");
      const price = interaction.fields.getTextInputValue("price");
      let traderId = traderInput.replace(/[<@!>]/g, "").trim();
      let trader;
      try {
        trader = await client.users.fetch(traderId);
      } catch {
        return interaction.reply({ content: "❗ Could not find that user. Please enter a valid Discord user ID.", ephemeral: true });
      }
      if (trader.id === interaction.user.id)
        return interaction.reply({ content: "❗ You cannot trade with yourself.", ephemeral: true });
      let id = data.nextId++;
      data.deals.push({ id, buyer: interaction.user.id, seller: trader.id, item, price, mm: null, status: "pending", channel: null });
      await saveDB();
      const mmRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes("middleman"));
      const embed = new EmbedBuilder()
        .setTitle(`🛡 Middleman Request — Deal #${id}`)
        .setDescription(`A new deal needs a middleman!`)
        .addFields(
          { name: "Buyer", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Seller", value: `<@${trader.id}>`, inline: true },
          { name: "Item", value: item },
          { name: "Price", value: price }
        )
        .setColor("Orange");
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`claim_${id}`).setLabel("Claim MM").setStyle(ButtonStyle.Success)
      );
      const mmChannel = interaction.guild.channels.cache.find(c => c.name === "mm-requests");
      if (mmChannel) mmChannel.send({ content: `${mmRole ? mmRole : "@here"}`, embeds: [embed], components: [row] });
      return interaction.reply({ content: `✅ Your MM request has been submitted! (Deal #${id})\n\nA middleman will claim your deal soon.`, ephemeral: true });
    }
  }
});

client.login(token);
