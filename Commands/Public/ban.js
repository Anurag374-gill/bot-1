const { create: CreateModLog } = require("../../Modules/ModLog");
const ArgParser = require("../../Modules/MessageUtils/Parser");

module.exports = async ({ client, Constants: { Colors }, configJS }, { serverDocument }, msg, commandData) => {
	if (msg.suffix) {
		const args = ArgParser.parseQuoteArgs(msg.suffix, msg.suffix.includes("|") ? "|" : " ");
		let member = args.shift();
		let isGuildMember = false;
		let reason = (args.length && args.join(" ")) || "Unspecified reason...";
		const isJustUserID = /^\d+$/.test(member);
		try {
			member = await client.memberSearch(member, msg.guild);
			isGuildMember = true;
		} catch (_) {
			if (isJustUserID) {
				if (msg.guild.members.get(member)) {
					member = msg.guild.members.get(member);
					isGuildMember = true;
				} else {
					member = await client.users.fetch(member, true);
					isGuildMember = false;
				}
			} else {
				member = null;
				isGuildMember = false;
			}
		}
		const { canClientBan, memberAboveAffected } = await client.canDoActionOnMember(msg.guild, msg.member, (isGuildMember && member) || null, "ban");
		if (!canClientBan) {
			return msg.channel.send({
				embed: {
					color: Colors.RED,
					title: `I'm sorry, but I can't do that... 😔`,
					description: `I'm missing permissions to ban that user!\nEither they are above me or I don't have the **Ban Members** permission.`,
				},
			});
		}
		if (!memberAboveAffected) {
			return msg.channel.send({
				embed: {
					color: Colors.RED,
					title: `I'm sorry, but I cannot let you do that! 😶`,
					description: `You cannot ban someone who's above you! That's dumb!`,
				},
			});
		}
		const banned = m => m.edit({
			embed: {
				image: {
					url: serverDocument.config.ban_gif,
				},
				color: Colors.LIGHT_GREEN,
				description: `Bye-Bye **@${isGuildMember ? client.getName(msg.guild, serverDocument, member) : `${member.tag}`}** 🔨`,
			},
		});
		const dmBanned = async id => {
			if (isGuildMember) {
				try {
					await client.users.get(id).send({
						embed: {
							color: Colors.RED,
							description: `Oh noes, you just got banned from \`${msg.guild}\`!`,
							fields: [
								{
									name: `Reason`,
									value: `${reason}`,
									inline: true,
								},
								{
									name: `Staff Member`,
									value: `${msg.author.tag}`,
									inline: true,
								},
							],
							thumbnail: {
								url: msg.guild.iconURL(),
							},
						},
					});
				} catch (_) {
					// Too bad
				}
			}
		};
		if (member) {
			let m = await msg.channel.send({
				embed: {
					color: Colors.LIGHT_BLUE,
					title: `Waiting on @__${client.getName(msg.guild, serverDocument, msg.member)}__'s imput..`,
					description: isJustUserID ? `Are you sure you want to ban **${isGuildMember ? `@${client.getName(msg.channel.guild, serverDocument, member)}` : member.tag}**?` : `Are you sure you want to ban **@${client.getName(msg.channel.guild, serverDocument, member)}**?`,
					footer: {
						text: `They won't be able to join again unless they get unbanned!`,
					},
				},
			});
			const mm = (await msg.channel.awaitMessages(mmm => mmm.author.id === msg.author.id, { max: 1, time: 60000 })).first();
			try {
				await mm.delete();
			} catch (_) {
				// Meh
			}
			if (mm && configJS.yesStrings.includes(mm.content.toLowerCase().trim())) {
				if (isGuildMember) {
					member.ban({ days: 1, reason: `${reason} | Command issued by @${msg.author.tag}` });
				} else {
					msg.guild.ban(member.id, { days: 1, reason: `${reason} | Command issued by @${msg.author.tag}` });
				}
				dmBanned(member.id);
				return banned(m);
			} else {
				return m.edit({
					embed: {
						description: `Ban canceled! 😓`,
						color: Colors.LIGHT_BLUE,
					},
				});
			}
		} else {
			msg.channel.send({
				embed: {
					color: Colors.LIGHT_RED,
					description: `I couldn't find a matching member on this server...`,
					footer: {
						text: `If you have a user ID you can run "${msg.guild.commandPrefix}${commandData.name} ID" to ban them!`,
					},
				},
			});
		}
	} else {
		let m = await msg.channel.send({
			embed: {
				color: Colors.LIGHT_RED,
				description: `Do you want me to ban you? 😮`,
				footer: {
					text: `You should mention someone who you want to ban, and give an optional reason...`,
				},
			},
		});
		const mm = (await msg.channel.awaitMessages(mmm => mmm.author.id === msg.author.id, { max: 1, time: 60000 })).first();
		if (mm && configJS.yesStrings.includes(mm.content.toLowerCase().trim())) {
			try {
				await mm.delete();
			} catch (_) {
				// Meh
			}
			m.edit({
				embed: {
					color: Colors.RED,
					description: `Ok! Bye-Bye!`,
					footer: {
						text: `Just kidding! I'd never ban you. ❤️`,
					},
				},
			});
		}
	}
};