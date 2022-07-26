import express from 'express';
import session from 'express-session';
import bodyParser from 'body-parser';
import {getServerConfig, loadDatabase, writeDatabase} from "./database";
import {router} from "./router";

async function main() {
    const app = express();

    await loadDatabase();

    app.use(session({ secret: "SomethingSomething", name: "scheduler.session" }));
    app.use(bodyParser.json());
    app.use(getServerConfig().pathBase, router);

    app.listen(getServerConfig().port, getServerConfig().host, () => {
        console.log(`Server listening on ${getServerConfig().host}:${getServerConfig().port}/${getServerConfig().pathBase}`);
    })
}

process.on('SIGINT', async () => {
    await writeDatabase();
    process.exit(0);
})

void main();
