'use strict';

// @ts-ignore
import MinioMixin from 'moleculer-minio';
import Moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import moleculer from 'moleculer';
import mime from 'mime-types';
import { v4 as uuidv4 } from 'uuid';
import { MultipartMeta } from '../types';
import { RestrictionType } from './api.service';

export const BUCKET_NAME = () => process.env.MINIO_BUCKET || 'pranesimai';

export enum FileTypes {
  PNG = 'image/png',
  JPEG = 'image/jpeg',
  JPG = 'image/jpg',
  PDF = 'application/pdf',
  MP4 = 'video/mp4',
  AVI = 'video/x-msvideo',
  MOV = 'video/quicktime',
  DOC = 'application/msword',
  DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export const DefaultFileTypes: string[] = Object.values(FileTypes);

export function getExtention(mimetype: string) {
  return mime.extension(mimetype);
}

export function getMimetype(filename: string) {
  return mime.lookup(filename);
}

export function getPublicFileName(length: number = 30) {
  function makeid(length: number) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  return makeid(length);
}

@Service({
  name: 'files',
  mixins: [MinioMixin],
  settings: {
    endPoint: process.env.MINIO_ENDPOINT,
    port: parseInt(process.env.MINIO_PORT || '9000'),
    useSSL: process.env.MINIO_USESSL === 'true',
    accessKey: process.env.MINIO_ACCESSKEY,
    secretKey: process.env.MINIO_SECRETKEY,
  },
})
export default class FilesService extends Moleculer.Service {
  @Action({
    params: {
      bucketName: {
        type: 'string',
        optional: true,
        default: BUCKET_NAME(),
      },
      objectName: 'string',
    },
  })
  getUrl(
    ctx: Context<{
      bucketName: string;
      objectName: string;
    }>,
  ) {
    const { bucketName, objectName } = ctx.params;
    const hostUrl = process.env.MINIO_PUBLIC_URL;
    return `${hostUrl}/${bucketName}/${objectName}`;
  }
  @Action({
    rest: <RestSchema>{
      method: 'POST',
      path: '/upload',
      type: 'multipart',
      busboyConfig: {
        limits: {
          files: 1,
        },
      },
    },
    auth: RestrictionType.SESSION,
  })
  async uploadFile(ctx: Context<NodeJS.ReadableStream, MultipartMeta>) {
    const { mimetype, filename } = ctx.meta;
    const name = getPublicFileName(50);

    if (!DefaultFileTypes.includes(mimetype)) {
      throw new moleculer.Errors.MoleculerClientError(
        'Unsupported MIME type.',
        400,
        'UNSUPPORTED_MIMETYPE',
      );
    }

    const extension = getExtention(mimetype);

    const objectFileName = `${name}.${extension}`;
    const bucketName = BUCKET_NAME();

    try {
      await ctx.call('files.putObject', ctx.params, {
        meta: {
          bucketName,
          objectName: objectFileName,
          metaData: {
            'Content-Type': mimetype,
          },
        },
      });
    } catch {
      throw new Moleculer.Errors.MoleculerClientError(
        'Unable to upload file.',
        400,
        'UNABLE_TO_UPLOAD',
      );
    }

    const { size }: { size: number } = await ctx.call('files.statObject', {
      objectName: objectFileName,
      bucketName,
    });

    const fileId = uuidv4();

    if (!this.broker.cacher) {
      throw new Moleculer.Errors.MoleculerClientError(
        'File upload cache is not configured.',
        500,
        'CACHE_NOT_CONFIGURED',
      );
    }

    await this.broker.cacher.set(
      `uploaded-file:${fileId}`,
      {
        bucketName,
        objectName: objectFileName,
        filename,
        size,
        uploadedAt: Date.now(),
      },
      60 * 60 * 24 * 365,
    );

    const response: any = {
      success: true,
      id: fileId,
      size,
      filename,
    };

    return response;
  }

  async started() {
    try {
      const bucketExists: boolean = await this.actions.bucketExists({
        bucketName: BUCKET_NAME(),
      });

      if (!bucketExists) {
        await this.actions.makeBucket({
          bucketName: BUCKET_NAME(),
        });

        await this.client.setBucketPolicy(
          BUCKET_NAME(),
          JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: {
                  AWS: ['*'],
                },
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${BUCKET_NAME()}/*`],
              },
            ],
          }),
        );

        await this.client.setBucketLifecycle(BUCKET_NAME(), {
          Rule: [
            {
              ID: 'Expiration Rule For Temp Files',
              Status: 'Enabled',
              Filter: {
                Prefix: 'temp/*',
              },
              Expiration: {
                Days: '7',
              },
            },
          ],
        });
      }
    } catch (err) {
      this.broker.logger.fatal(err);
    }
  }

  created() {
    if (!process.env.MINIO_ACCESSKEY || !process.env.MINIO_SECRETKEY) {
      this.broker.fatal('MINIO is not configured');
    }
  }
}
