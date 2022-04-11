import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { postToWebhook } from "./discord";
import { debug } from "debug";

interface MatchField {
    type: "string" | "select" | "list";
    name: string;
    displayInOverview: boolean;
    announceInDiscord: boolean;
    options?: string[] | MatchField;
}

export interface Match {
    date: string;
    players: string[];
    additionalData: { [key: string]: string | string[] };
    finished: boolean;
}

interface ServerConfig {
    host: string;
    port: number;
    pathBase: string;
    publicDomain: string;
    tournamentName: string;
    discord: {
        enableMatchupChannel: boolean;
        guildId: string;
        roleIds: string[];
        matchupWebhook: string;
        webhookUsername: string;
        webhookAvatar: string;
    }
}

interface PlayerIdMap {
    name: string;
    id: string;
}

let dbMatches: Match[] = [];
let dbSchema: MatchField[] = [];
let dbPlayers: PlayerIdMap[] = [];
let serverConfig: ServerConfig = {
    host: "localhost",
    port: 5000,
    pathBase: "",
    publicDomain: "",
    tournamentName: "unnamed tournament",
    discord: {
        enableMatchupChannel: false,
        guildId: "",
        matchupWebhook: "",
        roleIds: [],
        webhookUsername: "",
        webhookAvatar: ""
    }
};

const dbg = debug("database");

async function loadFile(file: string, defaultResponse: unknown): Promise<unknown> {
    try {
        return JSON.parse(await readFile(resolve(__dirname, file), 'utf-8'));
    } catch {
        dbg(`Config ${file} could not be found`);
        return defaultResponse;
    }
}

/**
 * Loads the databases from disk
 */
export async function loadDatabase(): Promise<void> {
    Object.assign(dbMatches, await loadFile("config/matches.json", []));
    Object.assign(dbSchema, await loadFile("config/schema.json", []));
    Object.assign(dbPlayers, await loadFile("config/players.json", []));
    Object.assign(serverConfig, await loadFile("config/config.json", {}));
}

/**
 * Saves the databases to disk
 */
export async function writeDatabase(): Promise<void> {
    await writeFile(resolve(__dirname, "config/matches.json"), JSON.stringify(dbMatches), 'utf-8');
    await writeFile(resolve(__dirname, "config/schema.json"), JSON.stringify(dbSchema), 'utf-8');
    await writeFile(resolve(__dirname, "config/config.json"), JSON.stringify(serverConfig), 'utf-8');
    await writeFile(resolve(__dirname, "config/players.json"), JSON.stringify(dbPlayers), 'utf-8');
}

/**
 * Returns the schema of additional match information
 */
export function getSchema(): MatchField[] {
    return dbSchema;
}

/**
 * Sets the schema to the supplied schema
 * @param schema Schema of the additional match information
 */
export async function setSchema(schema: MatchField[]): Promise<void> {
    dbSchema = schema;
    await writeDatabase();
}

/**
 * Returns all matches of the database, but without their additional data
 */
export function getAllMatches(): Match[] {
    return dbMatches;
}

/**
 * Updates a match index with the given data
 * If enabled, will also push a new message to discord if "public match information" changed
 * @param index Match index to update
 * @param data Match data to update with
 */
export async function updateMatch(index: number, data: Match): Promise<void> {
    // Checking if public stuff changed & webhook should be triggered
    let shouldPush = false;
    if (getServerConfig().discord.enableMatchupChannel) {
        if (dbMatches[index].date !== data.date && data.date !== null) {
            dbg("Pushing because of date");
            shouldPush = true;
        } else {
            if (JSON.stringify(dbMatches[index].players) !== JSON.stringify(data.players)) {
                dbg("Pushing because of players");
                shouldPush = true;
            } else {
                for (const key in data.additionalData) {
                    if (getSchema().filter((e) => {return e.name === key})[0]?.announceInDiscord) {
                        if (JSON.stringify(dbMatches[index].additionalData[key]) !== JSON.stringify(data.additionalData[key])) {
                            dbg("Pushing because of %s", key);
                            shouldPush = true;
                            break;
                        }
                    }
                }
            }
        }
    }

    dbg("Updating match %o", data);

    dbMatches[index] = data;

    if (shouldPush) {
        await postToWebhook(data, getServerConfig().discord.matchupWebhook, getServerConfig().tournamentName, getServerConfig().discord.webhookUsername, getServerConfig().discord.webhookAvatar);
    }
    await writeDatabase();
}

/**
 * Adds an unscheduled match between some players
 * @param players Players of the match
 */
export async function addMatch(players: string[]): Promise<void> {
    dbMatches.push({
        date: null,
        players,
        additionalData: {},
        finished: false
    });
    await writeDatabase();
}

/**
 * Returns the server config
 */
export function getServerConfig(): ServerConfig {
    return serverConfig;
}

/**
 * Sets the server config
 * @param config Config to set
 */
export async function setServerConfig(config: ServerConfig): Promise<void> {
    serverConfig = config;
    await writeDatabase();
}

export function getPlayerMappings(): PlayerIdMap[] {
    return dbPlayers;
}

export function getPlayerPing(name: string): string {
    const x = dbPlayers.filter(e => { return e.name === name })[0];
    if (x) {
        return `<@${x.id}>`;
    } else {
        return name;
    }
}

export async function setPlayerMappings(playerMappings: PlayerIdMap[]): Promise<void> {
    dbPlayers = playerMappings;
    await writeDatabase();
}
