'use strict';

import moleculer, { Context } from 'moleculer';
import { Service, Action } from 'moleculer-decorators';

@Service({
  name: 'addresses',
})
export default class AddressesService extends moleculer.Service {
  private baseUrl!: string;

  created() {
    this.baseUrl = process.env.REGISTRAI_BASE_URL || 'https://registrai.test.vmvt.lt';
  }

  @Action({
    name: 'findGyv',
    rest: 'GET /find/gyv',
    params: {
      q: 'string',
      top: { type: 'number', optional: true, convert: true },
    },
  })
  async findGyv(ctx: Context<{ q: string; top?: number }>) {
    const { q, top = 10 } = ctx.params;

    const url = `${this.baseUrl}/ar/find/gyv?q=${encodeURIComponent(q)}&top=${top}`;

    const result: any = await this.broker.call('http.get', {
      url,
      opt: { responseType: 'json' },
    });

    return result;
  }

  @Action({
    name: 'findAdr',
    rest: 'GET /find/adr',
    params: {
      gyv: 'number|convert',
      q: 'string',
      gat: { type: 'number', optional: true, convert: true },
      top: { type: 'number', optional: true, convert: true },
    },
  })
  async findAdr(ctx: Context<{ gyv: number; q: string; gat?: number; top?: number }>) {
    const { gyv, q, gat, top = 10 } = ctx.params;

    const qs = new URLSearchParams({
      gyv: String(gyv),
      q,
      top: String(top),
    });

    if (gat != null) {
      qs.set('gat', String(gat));
    }

    const url = `${this.baseUrl}/ar/find/adr?${qs.toString()}`;

    const result: any = await this.broker.call('http.get', {
      url,
      opt: { responseType: 'json' },
    });

    return result;
  }

  @Action({
    name: 'searchGat',
    rest: 'GET /search/gat',
    params: {
      gyv: 'number|convert',
      q: 'string',
      top: { type: 'number', optional: true, convert: true },
    },
  })
  async searchGat(ctx: Context<{ gyv: number; q: string; top?: number }>) {
    const { gyv, q, top = 10 } = ctx.params;

    const url = `${this.baseUrl}/ar/search/gat?gyv=${gyv}&q=${encodeURIComponent(q)}&top=${top}`;

    const result: any = await this.broker.call('http.get', {
      url,
      opt: { responseType: 'json' },
    });

    return result;
  }
}
