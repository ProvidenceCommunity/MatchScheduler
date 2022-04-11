import {getPlayerPing, getSchema, getServerConfig, Match} from "./database";
import 'dotenv/config';
import axios from 'axios';
import * as process from "process";
import { debug } from 'debug';

interface DiscordTokenCache {
    [key: string]: DiscordTokenCacheEntry;
}

interface DiscordTokenCacheEntry {
    expiresAt: number;
    refreshToken: string;
}

interface GuildUserQuery {
    user: {
        id: string;
        username: string;
        discriminator: string;
        avatar: string;
    };
    roles: string[];
}

interface GuildUserQueryResult {
    result: GuildUserQuery;
    token: string;
}

interface FullNameResult {
    fullName: string;
    token: string;
}

interface AvatarResult {
    avatarURL: string;
    token: string;
}

interface GuildUserCache {
    [key: string]: {
        data: GuildUserQuery;
        expiresAt: number;
    }
}

const oauthScopes = ["guilds.members.read"];
const tokenCache: DiscordTokenCache = {};
const userCache: GuildUserCache = {};
const dbg = debug("discord");

function getRedirectURI(): string {
    const serverConfig = getServerConfig();
    if (serverConfig.publicDomain !== "") {
        return encodeURIComponent(`https://${serverConfig.publicDomain}/${serverConfig.pathBase}discord_login`);
    } else {
        return encodeURIComponent(`http://${serverConfig.host}:${serverConfig.port}/${serverConfig.pathBase}discord_login`);
    }
}

export function getAuthorizationURI(code: string): string {
    return `https://discord.com/api/oauth2/authorize?response_type=code&client_id=${process.env.DISCORD_ID}` +
        `&scope=${encodeURIComponent(oauthScopes.join(" "))}` +
        `&state=${encodeURIComponent(code)}` +
        `&redirect_uri=${getRedirectURI()}`
}

export async function handleAuthorizationCallback(code: string): Promise<string> {
    const data = `client_id=${process.env.DISCORD_ID}` +
        `&client_secret=${process.env.DISCORD_SECRET}` +
        `&grant_type=authorization_code` +
        `&code=${code}` +
        `&redirect_uri=${getRedirectURI()}`;

    const r = await axios.post("https://discord.com/api/oauth2/token", data, {
        validateStatus: () => true
    });
    if (r.status !== 200) {
        dbg("Code exchange failed with code %d", r.status);
        throw new Error("#1: Code exchange failed.")
    }

    dbg("New token with %d time", r.data.expires_in);

    const token = r.data.access_token;
    const expiresAt = new Date().getTime() + (r.data.expires_in * 1000);
    const refreshToken = r.data.refresh_token;

    tokenCache[token] = {
        expiresAt,
        refreshToken
    };

    return token;
}

async function regenerateToken(token: string): Promise<string> {
    const data = `client_id=${process.env.DISCORD_ID}` +
        `&client_secret=${process.env.DISCORD_SECRET}` +
        `&grant_type=refresh_token` +
        `&refresh_token=${tokenCache[token].refreshToken}`;

    const r = await axios.post("https://discord.com/api/oauth2/token", data, {
        validateStatus: () => true
    });
    if (r.status !== 200) {
        dbg("Token refresh failed with code %d", r.status);
        throw new Error("#3: Token refresh failed.")
    }

    dbg("Refreshed token %s with new %d time", token, r.data.expires_in);

    const newToken = r.data.access_token;
    const expiresAt = new Date().getTime() + (r.data.expires_in * 1000);
    const refreshToken = r.data.refresh_token;

    delete tokenCache[token];

    tokenCache[newToken] = {
        expiresAt,
        refreshToken
    };

    return newToken;
}

async function queryGuildMember(token: string): Promise<void> {
    const r = await axios.get(`https://discord.com/api/v9/users/@me/guilds/${getServerConfig().discord.guildId}/member`, {
        validateStatus: () => true,
        headers: {
            "Authorization": "Bearer " + token
        }
    });
    if (r.status !== 200) {
        dbg("Guild member query failed with code %d", r.status);
        throw new Error("#2: Error while querying guild member.");
    }
    dbg("Queried guild user %d", r.data.user.username);
    userCache[token] = {
        data: r.data as GuildUserQuery,
        expiresAt: new Date().getTime() + 900 * 1000
    }
}

async function getGuildMember(token: string): Promise<GuildUserQueryResult> {
    if (tokenCache[token].expiresAt <= new Date().getTime() + 3600 * 1000) {
        // Token expires in 1h, let's renew it
        dbg("Token expiring in max 1hr");
        token = await regenerateToken(token);
    }
    if (!userCache[token]) {
        // We dont have this cached
        await queryGuildMember(token);
    }
    if (userCache[token].expiresAt <= new Date().getTime()) {
        // Guild member expires in 15min, let's requery it
        dbg("Guild member cache expired");
        await queryGuildMember(token);
    }

    return {
        result: userCache[token].data,
        token
    }
}

export async function getFullName(token: string): Promise<FullNameResult> {
    const member = await getGuildMember(token);
    return {
        fullName: `${member.result.user.username}#${member.result.user.discriminator}`,
        token: member.token
    };
}

export async function hasPermission(token: string): Promise<boolean> {
    try {
        const member = await getGuildMember(token);
        let hasPermission = false;
        for (const role of getServerConfig().discord.roleIds) {
            if (member.result.roles.includes(role)) {
                hasPermission = true;
            }
        }
        return hasPermission;
    } catch {
        return false;
    }
}

export async function getAvatar(token: string): Promise<AvatarResult> {
    const member = await getGuildMember(token);
    return {
        avatarURL: `https://cdn.discordapp.com/avatars/${member.result.user.id}/${member.result.user.avatar}.png`,
        token: member.token
    };
}

export function isTokenValid(token: string): boolean {
    if (tokenCache[token]) {
        return tokenCache[token].expiresAt >= new Date().getTime();
    } else {
        return false;
    }
}

export async function postToWebhook(match: Match, webhookURI: string, tournamentName: string, username?: string, avatar?: string): Promise<void> {
    const time = new Date(match.date).getTime() / 1000;
    let embed = {
        title: `A ${tournamentName} match has been scheduled!`,
        fields: [
            { name: "Players", value: match.players.map(e => { return getPlayerPing(e) }).join("\n") },
            { name: "Time", value: `<t:${time}>\n<t:${time}:R>`}
        ]
    };
    for (const key in match.additionalData) {
        if (getSchema().filter((e) => {return e.name === key})[0]?.announceInDiscord)
            if (typeof match.additionalData[key] === "object") {
                embed.fields.push({ name: key, value: (match.additionalData[key] as string[]).join("\n") });
            } else {
                embed.fields.push({ name: key, value: match.additionalData[key] as string });
        }
    }
    let data = {
        embeds: [embed],
        username: undefined,
        avatar_url: undefined
    }
    if (username !== "") {
        data.username = username;
    }
    if (avatar !== "") {
        data.avatar_url = avatar;
    }
    await axios.post(webhookURI, data);
}
