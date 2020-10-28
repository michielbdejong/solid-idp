
import defaultConfiguration from './defaultConfiguration/defaultConfiguration'
import {
  createServer as createServerHttps,
  Server as HttpsServer,
} from "https";
import { createServer as createServerHttp, Server as HttpServer } from "http";
import { IncomingMessage, ServerResponse } from "http";
import Debug from "debug";
import koaSend from "koa-send";
import Koa from "koa";
import koaStatic from "koa-static";
// import nodemailer from "nodemailer";
import { keystore } from "./keystore";
import path from "path";
import { readFileSync } from "fs";

const debug = Debug("server");

export type ConstructorOptions = {
  https: boolean;
  portListen: number;
  publicPortSuffix: string;
  publicProtocolSuffix: string;
  domain: string;
  cert: {
    key: Buffer;
    cert: Buffer;
  };
  dbFolder: string;
  appFolder: string;
};

export class Server {
  server: HttpsServer | HttpServer;
  idpHandler?: (req: IncomingMessage, res: ServerResponse) => void;
  staticsHandler: (req: IncomingMessage, res: ServerResponse) => void;
  options: ConstructorOptions;
  host: string;
  constructor(options: ConstructorOptions) {
    this.options = options;
    this.host = `http${options.publicProtocolSuffix}://${options.domain}${options.publicPortSuffix}`;
    const staticsApp = new Koa();
    staticsApp.use(koaStatic(options.appFolder, {}));
    staticsApp.use(async (ctx) => {
      if (ctx.status === 404) {
        await koaSend(ctx, "index.html", { root: options.appFolder });
      }
    });
    this.staticsHandler = staticsApp.callback();
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const handler = (req: IncomingMessage, res: ServerResponse) => {
      if (req.url.startsWith("/user")) {
        return this.serveProfileDoc(req, res);
      }

      if (
        req.url.startsWith("/.well-known") ||
        req.url.startsWith("/certs") ||
        req.url.startsWith("/reg") ||
        req.url.startsWith("/auth") ||
        req.url.startsWith("/interaction") ||
        req.url.startsWith("/resetpassword")
      ) {
        return this.idpHandler(req, res);
      }
      return this.staticsHandler(req, res);
    };
    if (options.https) {
      this.server = createServerHttps(options.cert, handler);
    } else {
      this.server = createServerHttp(handler);
    }
  }

  serveProfileDoc (req: IncomingMessage, res: ServerResponse) {
    res.end(`\
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#me> <acl:trustedApp> [
  acl:mode acl:Read, acl:Write, acl:Control;
  acl:origin <https://tester>
].
`   );
  }
  podRootFromUserName(username: string): URL {
    const sanitizedUsername = username.replace(/\W/g, "");
    return new URL(`/user/${sanitizedUsername}/`, this.host);
  }
  webIdFromPodRoot(podRoot: URL): URL {
    return new URL("#me", podRoot);
  }
  async listen(): Promise<void> {
    // const testAccount = await nodemailer.createTestAccount()
    const idpRouter = await defaultConfiguration({
      issuer: this.host,
      pathPrefix: "",
      keystore,
      mailConfiguration:
        process.env.EMAIL_USER && process.env.EMAIL_PASS
          ? {
              service: "gmail",
              auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
              },
            }
          : undefined,
      webIdFromUsername: async (username: string): Promise<string> => {
        return this.webIdFromPodRoot(
          this.podRootFromUserName(username)
        ).toString();
      },
      onNewUser: async (username: string): Promise<string> => {
        const podRoot = this.podRootFromUserName(username);
        const webId = this.webIdFromPodRoot(podRoot);
        return webId.toString();
      },
      storagePreset: "filesystem",
      storageData: {
        folder: path.join(__dirname, this.options.dbFolder), // used if storagePreset is "filesystem"
      },
    });
    const idpApp = new Koa();
    idpApp.use(idpRouter.routes());
    idpApp.use(idpRouter.allowedMethods());
    this.idpHandler = idpApp.callback();

    this.server.listen(this.options.portListen);
    debug("listening on port", this.options.portListen);
  }
  async close(): Promise<void> {
    this.server.close();
    debug("closing port", this.options.portListen);
  }
}

function getInt(str: string): number | undefined {
  const candidate: number = parseInt(str);
  if (isNaN(candidate)) {
    return undefined;
  }
  return candidate;
}

export function run () {
  // on startup:
  const config: ConstructorOptions = {
    https: !!process.env.HTTPS,
    portListen: getInt(process.env.PORT),
    domain: process.env.DOMAIN || "localhost",
    publicPortSuffix: process.env.PUBLIC_PORT_SUFFIX || "",
    publicProtocolSuffix: process.env.PUBLIC_PROTOCOL_SUFFIX || "",
    cert: undefined,
    appFolder: "static/",
    dbFolder: "../.db" // NSS-compatible user database
  };
  
  if (config.https) {
    console.log(`Running with https`);
    try {
      config.cert = {
        key: readFileSync(process.env.TLS_KEY || "server.key"),
        cert: readFileSync(process.env.TLS_CERT || "server.cert"),
      };
    } catch (e) {
      throw new Error("Could not load ./server.key and ./server.cert");
    }
  } else {
    console.log(`Not running with https`);
  }
  
  debug("Starting", config);
  const server = new Server(config);
  debug("listening...");
  server.listen().catch(console.error.bind(console)); 
}

// ...
if (require.main === module) {
  run();
}