const {
	NewServer: getNewServerData,
	PostData,
	Utils,
} = require("../Modules/");
const {
	ClearServerStats: clearStats,
	Giveaways,
	MessageOfTheDay: createMessageOfTheDay,
	SetCountdown: setCountdown,
	SetReminder: setReminder,
	StreamChecker: sendStreamerMessage,
	StreamingRSS: sendStreamingRSSUpdates,
} = Utils;

/* eslint-disable max-len */
module.exports = async (bot, db, configJS, configJSON) => {
	// Count a server's stats (games, clearing, etc.);
	const statsCollector = async () => {
		const promiseArray = [];
		const countServerStats = async server => {
			const serverDocument = await db.servers.findOne({ _id: server.id }).exec().catch(err => {
				winston.warn(`Failed to find server document for counting stats >.<`, { svrid: server.id }, err);
			});
			if (serverDocument) {
				// Clear stats for server if older than a week
				if (Date.now() - serverDocument.stats_timestamp >= 604800000) {
					await clearStats(bot, db, server, serverDocument);
				} else {
					// Iterate through all members
					server.members.forEach(async member => {
						if (member.id !== bot.user.id && !member.user.bot) {
							const game = await bot.getGame(member);
							if (game !== "" && member.presence.status === "online") {
								let gameDocument = serverDocument.games.id(game);
								if (!gameDocument) {
									serverDocument.games.push({ _id: game });
									gameDocument = serverDocument.games.id(game);
								}
								gameDocument.time_played++;
							}

							// Kick member if they're inactive and autokick is on
							const memberDocument = serverDocument.members.id(member.id);
							if (memberDocument && serverDocument.config.moderation.isEnabled && serverDocument.config.moderation.autokick_members.isEnabled && Date.now() - memberDocument.last_active > serverDocument.config.moderation.autokick_members.max_inactivity && !memberDocument.cannotAutokick && bot.getUserBotAdmin(server, serverDocument, member) === 0) {
								try {
									await member.kick(`Kicked for inactivity on server.`);
									winston.verbose(`Kicked member "${member.user.tag}" due to inactivity on server "${server}"`, { svrid: server.id, usrid: member.id });
								} catch (err) {
									memberDocument.cannotAutokick = true;
									winston.warn(`Failed to kick member "${member.user.tag}" due to inactivity on server "${server}"`, { svrid: server.id, usrid: member.id }, err);
								}
							}
						}
					});
					try {
						await serverDocument.save();
					} catch (err) {
						winston.warn(`Failed to save server data for stats.. <.>`, { svrid: server.id }, err);
					}
				}
			}
		};
		bot.guilds.forEach(guild => {
			promiseArray.push(countServerStats(guild));
		});
		await Promise.all(promiseArray);
	};

	// Set existing reminders to send message when they expire
	const setReminders = async () => {
		const promiseArray = [];
		const userDocuments = await db.users.find({ reminders: { $not: { $size: 0 } } }).exec().catch(err => {
			winston.warn(`Failed to get reminders from db (-_-*)`, err);
		});
		if (userDocuments) {
			for (let i = 0; i < userDocuments.length; i++) {
				for (let j = 0; j < userDocuments[i].reminders.length; j++) {
					promiseArray.push(setReminder(bot, userDocuments[i], userDocuments[i].reminders[j]));
				}
			}
		}
		await Promise.all(promiseArray);
	};

	// Set existing countdowns in servers to send message when they expire
	const setCountdowns = async () => {
		const promiseArray = [];
		const serverDocuments = await db.servers.find({ "config.countdown_data": { $not: { $size: 0 } } }).exec().catch(err => {
			winston.warn("Failed to get countdowns from db (-_-*)", err);
		});
		if (serverDocuments) {
			for (let i = 0; i < serverDocuments.length; i++) {
				for (let j = 0; j < serverDocuments[i].config.countdown_data.length; j++) {
					promiseArray.push(setCountdown(bot, serverDocuments[i], serverDocuments[i].config.countdown_data[j]));
				}
			}
		}
		await Promise.all(promiseArray);
	};

	// Set existing giveaways to end when they expire
	const setGiveaways = async () => {
		const promiseArray = [];
		const serverDocuments = await db.servers.find({
			channels: {
				$elemMatch: {
					"giveaway.isOngoing": true,
				},
			},
		}).exec().catch(err => {
			winston.warn("Failed to get giveaways from db (-_-*)", err);
		});
		if (serverDocuments) {
			serverDocuments.forEach(serverDocument => {
				const svr = bot.guilds.get(serverDocument._id);
				if (svr) {
					serverDocument.channels.forEach(channelDocument => {
						if (channelDocument.giveaway.isOngoing) {
							const ch = svr.channels.get(channelDocument._id);
							if (ch) {
								promiseArray.push(Giveaways.endTimedGiveaway(bot, db, svr, ch, channelDocument.giveaway.expiry_timestamp));
							}
						}
					});
				}
			});
		}
		await Promise.all(promiseArray);
	};

	// Start streaming RSS timer
	const startStreamingRSS = async () => {
		const serverDocuments = await db.servers.find({}).exec().catch(err => {
			winston.warn(`Failed to get servers from db (-_-*)`, err);
		});
		if (serverDocuments) {
			const sendStreamingRSSToServer = async i => {
				if (i < serverDocuments.length) {
					const serverDocument = serverDocuments[i];
					const server = bot.guilds.get(serverDocument._id);
					if (server) {
						const sendStreamingRSSFeed = async j => {
							if (j < serverDocument.config.rss_feeds.length) {
								if (serverDocument.config.rss_feeds[j].streaming.isEnabled) {
									sendStreamingRSSUpdates(bot, server, serverDocument, serverDocument.config.rss_feeds[j]).then(async () => {
										await sendStreamingRSSFeed(++j);
									});
								} else {
									await sendStreamingRSSFeed(++j);
								}
							} else {
								await sendStreamingRSSToServer(++i);
							}
						};
						await sendStreamingRSSFeed(0);
					}
				} else {
					setTimeout(async () => {
						await startStreamingRSS();
					}, 600000);
				}
			};
			await sendStreamingRSSToServer(0);
		}
	};

	// Periodically check if people are streaming
	// Totally not stalking 👀 // Vlad
	const checkStreamers = async () => {
		const serverDocuments = await db.servers.find({}).exec().catch(err => {
			winston.warn(`Failed to get server documents for streamers (-_-*)`, err);
		});
		if (serverDocuments) {
			const checkStreamersForServer = async i => {
				if (i < serverDocuments.length) {
					const serverDocument = serverDocuments[i];
					const server = bot.guilds.get(serverDocument._id);
					if (server) {
						const checkIfStreaming = async j => {
							if (j < serverDocument.config.streamers_data.length) {
								sendStreamerMessage(server, serverDocument, serverDocument.config.streamers_data[j]).then(async () => {
									await checkIfStreaming(++j);
								}).catch(err => {
									winston.debug(`Failed to send streaming message to server ;.;\n`, err);
								});
							} else {
								await checkStreamersForServer(++i);
							}
						};
						await checkIfStreaming(0);
					}
				} else {
					setTimeout(async () => {
						await checkStreamers();
					}, 600000);
				}
			};
			await checkStreamersForServer(0);
		}
	};

	// Start message of the day timer
	// This time, no more bork, hopefully..
	const startMessageOfTheDay = async () => {
		const serverDocuments = await db.servers.find({
			"config.message_of_the_day.isEnabled": true,
		}).exec().catch(err => {
			winston.warn(`Failed to find server data for message of the day <.<\n`, err);
		});
		if (serverDocuments) {
			const promiseArray = [];
			for (let i = 0; i < serverDocuments.length; i++) {
				const server = bot.guilds.get(serverDocuments[i]._id);
				if (server) {
					promiseArray.push(createMessageOfTheDay(bot, db, server, serverDocuments[i].config.message_of_the_day));
				}
			}
			await Promise.all(promiseArray);
		}
	};

		// // Start all timer extensions (third-party)
		// I'll finish these once we have an actual extension api
		// const runTimerExtensions = () => {
		// 	db.servers.find({"extensions": {$not: {$size: 0}}}, (err, serverDocuments) => {
		// 		if(err) {
		// 			winston.error("Failed to find server data to start timer extensions", err);
		// 		} else {
		// 			for(let i=0; i<serverDocuments.length; i++) {
		// 				const svr = bot.guilds.get(serverDocuments[i]._id);
		// 				if(svr) {
		// 					serverDocuments[i].extensions.forEach(extensionDocument => {
		// 						if(extensionDocument.type=="timer") {
		// 							setTimeout(() => {
		// 								runTimerExtension(bot, db, winston, svr, serverDocuments[i], extensionDocument);
		// 							}, (extensionDocument.last_run + extensionDocument.interval) - Date.now());
		// 						}
		// 					});
		// 				}
		// 			}
		// 		}
		// 	});
		// };

	// Print startup ASCII art in console
	const showStartupMessage = () => {
		bot.isReady = true;
		const ascii = `
  _____                                               ____        _   
 / ____|   /\\                                        |  _ \\      | |  
| |  __   /  \\__      _____  ___  ___  _ __ ___   ___| |_) | ___ | |_ 
| | |_ | / /\\ \\ \\ /\\ / / _ \\/ __|/ _ \\| '_ \` _ \\ / _ \\  _ < / _ \\| __|
| |__| |/ ____ \\ V  V /  __/\\__ \\ (_) | | | | | |  __/ |_) | (_) | |_ 
 \\_____/_/    \\_\\_/\\_/ \\___||___/\\___/|_| |_| |_|\\___|____/ \\___/ \\__|																																		 	
		`;
		winston.info(`The best Discord Bot, version ${configJSON.version}, is now ready!`);
		if (process.env.SHARD_ID === "0") {
			// I know I know, console.log, deal with it 😎
			console.log(ascii);
		}
	};

	// Set messages_today to 0 for all servers
	// And start a chain of events..
	const startMessageCount = async () => {
		await db.servers.update({}, { messages_today: 0 }, { multi: true }).exec().catch(err => {
			winston.warn(`Failed to start message counter.. >->`, err);
		});
		const clearMessageCount = () => {
			db.servers.update({}, { messages_today: 0 }, { multi: true }).exec();
		};
		setInterval(clearMessageCount, 86400000);
		await Promise.all([statsCollector(), setReminders(), setCountdowns(), setGiveaways(), startStreamingRSS(), checkStreamers(), startMessageOfTheDay()]);
		PostData(bot);
		showStartupMessage();
	};

	// Set bot's "now playing" game
	const setBotGame = async () => {
		let gameObject = {
			name: configJSON.game.name,
			url: configJSON.game.twitchURL,
		};
		if (configJSON.game.name === "default") {
			gameObject = {
				name: "https://gawesomebot.com",
				url: "",
			};
		}
		bot.user.setPresence({
			game: gameObject,
			status: configJSON.status,
		});
		await startMessageCount();
	};

	// Delete data for old servers
	const pruneServerData = async () => {
		db.servers.find({
			_id: {
				$nin: await Utils.GetValue(bot, "guilds.keys()", "arr", "Array.from"),
			},
		}).remove()
			.exec()
			.catch(err => {
				winston.warn(`Failed to prune old server documents -_-`, err);
			});
		await setBotGame();
	};

	// Ensure that all servers hava database documents
	const shardGuildIterator = bot.guilds.entries();
	const checkServerData = async (server, newServerDocuments) => {
		const serverDocument = await db.servers.findOne({ _id: server.id }).exec().catch(err => {
			winston.warn(`Failed to find server data.. Sorry!`, err);
		});
		if (serverDocument) {
			const channelIDs = server.channels.map(a => a.id);
			for (let j = 0; j < serverDocument.channels.length; j++) {
				if (!channelIDs.includes(serverDocument.channels[j]._id)) {
					serverDocument.channels[j].remove();
				}
			}
		} else {
			newServerDocuments.push(await getNewServerData(bot, server, new db.servers({ _id: server.id })));
		}
		try {
			checkServerData(shardGuildIterator.next().value[1], newServerDocuments).catch(err => { // eslint-disable-line arrow-body-style, handle-callback-err, no-unused-vars
				return newServerDocuments;
			});
		} catch (err) {
			return newServerDocuments;
		}
	};
	try {
		checkServerData(shardGuildIterator.next().value[1], []).then(async newServerDocuments => {
			if (typeof newServerDocuments !== "undefined" && newServerDocuments.length > 0) {
				winston.info(`Created documents for ${newServerDocuments.length} new servers!`);
				db.servers.insertMany(newServerDocuments).catch(err => {
					winston.warn(`Failed to insert new server documents..`, err);
				}).then(async () => {
					winston.info(`Successfully inserted ${newServerDocuments.length} new server documents into the database! \\o/`);
					await pruneServerData();
				});
			} else {
				await pruneServerData();
			}
		});
	} catch (err) {
		await pruneServerData();
	}
};