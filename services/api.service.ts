import cookie from 'cookie';
import moleculer, { Context, Errors } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import ApiGateway, { IncomingRequest, Route } from 'moleculer-web';
import { EndpointType, ResponseHeadersMeta, SESSION_MAX_AGE_SECONDS } from '../types';
import { ServerResponse } from 'http';
import { Session } from './sessions.service';
import { Survey } from './surveys.service';

export interface MetaSession {
  session?: Session;
  isExternalRequest?: boolean; // as opposed to internal VMVT network
}

export enum RestrictionType {
  PUBLIC = 'PUBLIC',
  SESSION = 'SESSION',
}

@Service({
  name: 'api',
  mixins: [ApiGateway],
  // More info about settings: https://moleculer.services/docs/0.14/moleculer-web.html
  settings: {
    port: process.env.PORT || 3000,
    path: '',

    // Global CORS settings for all routes
    cors: {
      // Configures the Access-Control-Allow-Origin CORS header.
      origin: '*',
      // Configures the Access-Control-Allow-Methods CORS header.
      methods: ['GET', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
      // Configures the Access-Control-Allow-Headers CORS header.
      allowedHeaders: '*',
      // Configures the Access-Control-Expose-Headers CORS header.
      exposedHeaders: [],
      // Configures the Access-Control-Allow-Credentials CORS header.
      credentials: false,
      // Configures the Access-Control-Max-Age CORS header.
      maxAge: 3600,
    },

    routes: [
      {
        path: '/',
        whitelist: [
          'addresses.findAdr',
          'addresses.findGyv',
          'addresses.searchGat',
          'api.ping',
          'files.uploadFile',
          'responses.get',
          'responses.respond',
          'sessions.cancel',
          'sessions.current',
          'sessions.evartai',
          'sessions.start',
          'surveys.getAll',
          'surveys.mermaid',
        ],

        // Route-level Express middlewares. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Middlewares
        use: [],

        // Enable/disable parameter merging method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Disable-merging
        mergeParams: true,

        // The auto-alias feature allows you to declare your route alias directly in your services.
        // The gateway will dynamically build the full routes from service schema.
        autoAliases: true,

        aliases: {
          'GET /ping': 'api.ping',
        },

        // Enable authentication. Implement the logic into `authenticate` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authentication
        authentication: true,

        // Enable authorization. Implement the logic into `authorize` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authorization
        authorization: true,

        // Calling options. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Calling-options
        callingOptions: {},

        bodyParsers: {
          json: {
            strict: false,
            limit: '1MB',
          },
          urlencoded: {
            extended: true,
            limit: '1MB',
          },
        },

        // Mapping policy setting. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Mapping-policy
        mappingPolicy: 'all', // Available values: "all", "restrict"

        // Enable/disable logging
        logging: true,
      },
    ],
    // Do not log client side errors (does not log an error response when the error.code is 400<=X<500)
    log4XXResponses: false,
    // Logging the request parameters. Set to any log level to enable it. E.g. "info"
    logRequestParams: null,
    // Logging the response data. Set to any log level to enable it. E.g. "info"
    logResponseData: null,
    // Serve assets from "public" folder
    //    assets: {
    //      folder: 'public',
    //      // Options to `server-static` module
    //      options: {},
    //    },
  },
})
export default class ApiService extends moleculer.Service {
  @Method
  isExternalRequest(req: IncomingRequest) {
    return typeof req.headers['cf-connecting-ip'] === 'string';
  }

  @Action({
    auth: EndpointType.PUBLIC,
  })
  ping() {
    return {
      timestamp: Date.now(),
    };
  }

  @Method
  async authenticate(
    ctx: Context<unknown, MetaSession & ResponseHeadersMeta>,
    _route: Route,
    req: IncomingRequest,
  ) {
    ctx.meta.isExternalRequest = this.isExternalRequest(req);

    const cookies = cookie.parse(req.headers.cookie || '');
    if (!cookies['vmvt-session-token']) {
      return;
    }

    const session: Session = await ctx.call('sessions.findOne', {
      query: {
        token: cookies['vmvt-session-token'],
      },
    });

    if (!session) {
      return;
    }

    if (this.isExpiredSession(session)) {
      ctx.meta.$responseHeaders = {
        'Set-Cookie': cookie.serialize('vmvt-session-token', '', {
          path: '/',
          httpOnly: true,
          maxAge: 0,
        }),
      };
      return;
    }

    ctx.meta.session = session;
  }

  @Method
  isExpiredSession(session: Session) {
    if (session.finishedAt || session.canceledAt) {
      return true;
    }

    const createdAt = new Date(session.createdAt).getTime();
    return createdAt + SESSION_MAX_AGE_SECONDS * 1000 < Date.now();
  }

  @Method
  async authorize(
    ctx: Context<unknown, MetaSession>,
    _route: Route,
    req: IncomingRequest,
  ): Promise<unknown> {
    const restrictionType = this.getRestrictionType(req);

    if (restrictionType === RestrictionType.PUBLIC) {
      return;
    }

    if (!ctx.meta.session) {
      throw new ApiGateway.Errors.UnAuthorizedError(ApiGateway.Errors.ERR_INVALID_TOKEN, null);
    }
  }

  @Method
  getRestrictionType(req: IncomingRequest) {
    return req.$action.auth || req.$action.service?.settings?.auth || RestrictionType.PUBLIC;
  }

  @Method
  sendError(
    req: IncomingRequest & { $next?: (err: Error) => void; $ctx?: any },
    res: ServerResponse,
    err: any,
  ) {
    if (!this.shouldSanitizeErrors()) {
      return ApiGateway.methods.sendError.call(this, req, res, err);
    }

    if (req.$next) {
      return req.$next(err);
    }

    if (res.headersSent) {
      this.logger.warn('Headers have already sent', req.url, err);
      return;
    }

    const responseHeaders = req.$ctx?.meta?.$responseHeaders;
    if (responseHeaders) {
      Object.keys(responseHeaders).forEach((key) => {
        try {
          res.setHeader(key, responseHeaders[key]);
        } catch (_error) {
          res.setHeader(key, encodeURI(responseHeaders[key]));
        }
      });
    }

    const code = this.getErrorStatusCode(err);
    if (this.requestAcceptsHtml(req)) {
      res.writeHead(code);
      res.end();
    } else {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          code,
          message: this.getPublicErrorMessage(code),
        }),
      );
    }

    this.logResponse(req, res);
  }

  @Method
  shouldSanitizeErrors() {
    return process.env.NODE_ENV !== 'local';
  }

  @Method
  getErrorStatusCode(err: any) {
    return typeof err?.code === 'number' && err.code >= 400 && err.code < 600 ? err.code : 500;
  }

  @Method
  getPublicErrorMessage(code: number) {
    switch (code) {
      case 400:
        return 'Bad Request';
      case 401:
        return 'Unauthorized';
      case 403:
        return 'Forbidden';
      case 404:
        return 'Not Found';
      case 405:
        return 'Method Not Allowed';
      case 413:
        return 'Payload Too Large';
      case 429:
        return 'Too Many Requests';
      default:
        return code >= 500 ? 'Internal Server Error' : 'Request Failed';
    }
  }

  @Method
  requestAcceptsHtml(req: IncomingRequest) {
    const accept = req.headers.accept || '';
    return typeof accept === 'string' && accept.includes('text/html');
  }
}
