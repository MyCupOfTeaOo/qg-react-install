import fse from 'fs-extra';
import execa from 'execa';
import signale from 'signale';
import nconf from 'nconf';
import joi from 'joi';
import glob from 'glob';
import { Context, Com } from '../interface';

interface Builder {
  clear: boolean;
  save: boolean;
  install: Com[];
  sync: Com[];
  link: boolean;
  unlink: boolean;
  commit: {
    message?: string;
  };
}

const schema = joi
  .object({
    clear: joi.boolean(),
    save: joi.boolean(),
    install: joi.array().items(joi.object()),
    sync: joi.array().items(joi.object()),
    link: joi.boolean(),
    unlink: joi.boolean(),
    commit: joi.object({
      message: joi.string(),
    }),
  })
  .xor('link', 'unlink')
  .xor('sync', 'install');

class ComRunner {
  ctx: Context;
  builder: Partial<Builder> = {};
  config = nconf.get('com');
  interactiveLogger = new signale.Signale({
    interactive: true,
    scope: 'com',
  });
  logger = new signale.Signale({
    interactive: false,
    scope: 'com',
  });

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  comList = async () => {
    this.interactiveLogger.time('parse com');
    this.interactiveLogger.await('parse com info');
    this.interactiveLogger.timeEnd('parse com');
    const comList = await new Promise((resolve, reject) => {
      glob(
        './src/components/*/package.json',
        {
          cwd: this.ctx.COM_PATH,
        },
        (err, matchers) => {
          if (err) {
            reject(err);
          } else {
            resolve(matchers);
          }
        },
      );
    });
    console.log(comList);
    return [] as Com[];
  };

  syncComList = async () => {
    return [] as Com[];
  };

  load = async () => {
    // 加载组件库
    if (!(await fse.pathExists(this.ctx.COM_PATH))) {
      this.logger.await(`ready to download com repository: ${this.config.url}`);
      await fse.mkdir(this.ctx.COM_PATH);
      await execa('git', ['clone', this.config.url, '--depth', '1'], {
        stdout: process.stdout,
        cwd: this.ctx.COM_PATH,
      });
      this.logger.success('download done');
    } else {
      this.logger.await(`ready to update com repository: ${this.config.url}`);
      await execa('git', ['pull'], {
        stdout: process.stdout,
        cwd: this.ctx.COM_PATH,
      });
      this.logger.success('update done');
    }
  };

  exec = async () => {
    schema.validate(this.ctx);
    console.log(this.builder);
  };

  url = (url: string) => {
    this.config.url = url;
    return this;
  };

  clear = () => {
    this.builder.clear = true;
    return this;
  };

  save = () => {
    this.builder.save = true;
    return this;
  };

  install = (com: Com) => {
    if (!this.builder.install) {
      this.builder.install = [];
    }
    if (Array.isArray(com)) {
      this.builder.install.push(...com);
    } else {
      this.builder.install.push(com);
    }
    return this;
  };

  sync = (com: Com | Com[]) => {
    if (!this.builder.sync) {
      this.builder.sync = [];
    }
    if (Array.isArray(com)) {
      this.builder.sync.push(...com);
    } else {
      this.builder.sync.push(com);
    }
    return this;
  };

  link = () => {
    this.builder.link = true;
    this.builder.unlink = false;
    return this;
  };

  unlink = () => {
    this.builder.link = false;
    this.builder.unlink = true;
    return this;
  };

  commit = (message?: string) => {
    this.builder.commit = {
      message,
    };
    return this;
  };
}

export default ComRunner;
