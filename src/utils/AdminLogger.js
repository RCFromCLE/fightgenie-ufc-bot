// src/utils/AdminLogger.js
const fs = require('fs').promises;
const path = require('path');

class AdminLogger {
    static LOG_FILE = path.join(__dirname, '../../admin.log');

    static async logServerStats(client) {
        try {
            const timestamp = new Date().toISOString();
            const stats = {
                servers: Array.from(client.guilds.cache).map(([id, guild]) => ({
                    name: guild.name,
                    id: id,
                    memberCount: guild.memberCount
                })),
                totalServers: client.guilds.cache.size,
                totalMembers: client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0),
                uptime: Math.floor(client.uptime / 1000 / 60), // minutes
                memoryUsage: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024) // MB
            };

            const logEntry = `\n[${timestamp}]\n` +
                `Total Servers: ${stats.totalServers}\n` +
                `Total Members: ${stats.totalMembers}\n` +
                `Uptime: ${stats.uptime} minutes\n` +
                `Memory Usage: ${stats.memoryUsage}MB\n` +
                '\nServer Details:\n' +
                stats.servers.map(server => 
                    `- ${server.name} (ID: ${server.id}): ${server.memberCount} members`
                ).join('\n') +
                '\n----------------------------------------\n';

            await fs.appendFile(this.LOG_FILE, logEntry);
            console.log('Admin stats logged successfully');
        } catch (error) {
            console.error('Error logging admin stats:', error);
        }
    }
}

module.exports = AdminLogger;