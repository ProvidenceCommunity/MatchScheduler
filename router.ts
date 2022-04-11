import {Router} from 'express';
import {
    getAuthorizationURI,
    getAvatar,
    getFullName,
    handleAuthorizationCallback,
    hasPermission,
    isTokenValid
} from "./discord";
import {
    addMatch,
    getAllMatches, getPlayerMappings,
    getSchema,
    getServerConfig,
    loadDatabase, setPlayerMappings, setSchema,
    setServerConfig,
    updateMatch
} from "./database";
import {readFile} from 'fs/promises';
import {resolve} from "path";

interface SchedulerSession {
    discordToken: string;
}

export const router = Router();

router.get("/", async (req, res) => {
    const session = req.session as unknown as SchedulerSession;
    if (session.discordToken && isTokenValid(session.discordToken)) {
        if (await hasPermission(session.discordToken)) {
            res.sendFile(resolve(__dirname, "html/mainPage.html"));
            return;
        } else {
            res.sendFile(resolve(__dirname, "html/noPermission.html"));
            return;
        }
    } else {
        res.send((await readFile(resolve(__dirname, "html/login.html"), "utf-8"))
            .replaceAll("%DISCORD_LOGIN%", getAuthorizationURI(req.sessionID)));
        return;
    }
});

router.get("/api/user", async (req, res) => {
    const session = req.session as unknown as SchedulerSession;
    let token = session.discordToken;

    try {
        const fullName = await getFullName(token);
        token = fullName.token;
        const avatar = await getAvatar(token);
        token = avatar.token;

        (req.session as unknown as SchedulerSession).discordToken = token;

        res.json({
            name: fullName.fullName,
            avatar: avatar.avatarURL
        })
    } catch(e) {
        console.log(e);
        res.send("An error occurred: " + e);
    }
});

router.get("/api/matches", async (req, res) => {
    const session = req.session as unknown as SchedulerSession;
    let token = session.discordToken;
    if (!await hasPermission(token)) {
        res.sendStatus(403);
    } else {
        res.json(getAllMatches());
    }
});

router.put("/api/match", async (req, res) => {
    const session = req.session as unknown as SchedulerSession;
    let token = session.discordToken;
    if (!await hasPermission(token)) {
        res.sendStatus(403);
    } else {
        await addMatch(req.body.players);
        res.sendStatus(201);
    }
});

router.patch("/api/match", async (req, res) => {
    const session = req.session as unknown as SchedulerSession;
    let token = session.discordToken;
    if (!await hasPermission(token)) {
        res.sendStatus(403);
    } else {
        await updateMatch(parseInt(req.query.matchId as string), req.body.match);
        res.sendStatus(204);
    }
});

router.get("/api/config", async (req, res) => {
    const session = req.session as unknown as SchedulerSession;
    let token = session.discordToken;
    if (!await hasPermission(token)) {
        res.sendStatus(403);
    } else {
        res.json(getServerConfig());
    }
});

router.patch("/api/config", async (req, res) => {
    const session = req.session as unknown as SchedulerSession;
    let token = session.discordToken;
    if (!await hasPermission(token)) {
        res.sendStatus(403);
    } else {
        await setServerConfig(req.body.config);
        res.sendStatus(204);
    }
});

router.get("/api/schema", async (req, res) => {
    const session = req.session as unknown as SchedulerSession;
    let token = session.discordToken;
    if (!await hasPermission(token)) {
        res.sendStatus(403);
    } else {
        res.json(getSchema());
    }
});

router.patch("/api/schema", async (req, res) => {
    const session = req.session as unknown as SchedulerSession;
    let token = session.discordToken;
    if (!await hasPermission(token)) {
        res.sendStatus(403);
    } else {
        await setSchema(req.body.schema);
        res.sendStatus(204);
    }
});

router.get("/api/players", async (req, res) => {
    const session = req.session as unknown as SchedulerSession;
    let token = session.discordToken;
    if (!await hasPermission(token)) {
        res.sendStatus(403);
    } else {
        res.json(getPlayerMappings());
    }
});

router.patch("/api/players", async (req, res) => {
    const session = req.session as unknown as SchedulerSession;
    let token = session.discordToken;
    if (!await hasPermission(token)) {
        res.sendStatus(403);
    } else {
        await setPlayerMappings(req.body.players);
        res.sendStatus(204);
    }
});


router.get("/api/reloadConfig", async (req, res) => {
    const session = req.session as unknown as SchedulerSession;
    let token = session.discordToken;
    if (!await hasPermission(token)) {
        res.sendStatus(403);
    } else {
        await loadDatabase();
        res.sendStatus(204);
    }
});

router.get("/discord_login", async (req, res) => {
    if (req.sessionID !== req.query.state) {
        res.send("Error: Incorrect state");
        return;
    }

    (req.session as unknown as SchedulerSession).discordToken = await handleAuthorizationCallback(req.query.code as string);

    res.redirect("/");
})
