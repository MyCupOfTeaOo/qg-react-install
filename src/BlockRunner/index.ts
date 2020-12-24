import fse from 'fs-extra';
import execa from 'execa';
import path from 'path';
import * as changeCase from 'change-case';
import compareVersions from 'compare-versions';
import { WriteStream } from 'tty';
import signale from 'signale';
import nconf from 'nconf';
import joi from 'joi';
import glob from 'glob';
import rimraf from 'rimraf';
import { Observable } from 'rxjs';
import Listr from 'listr';
import ComRunner from '../ComRunner';
import { Context, BaseLink, Block, BlockPackage, Com } from '../interface';
import { saveConfig, streamPrint, separator } from '../utils';

interface Builder {
  save: boolean;
  install: Block[];
  sync: Block[];
  link: boolean;
  unlink: Block[];
  commit: {
    message?: string;
  };
  overwrite: boolean;
}

const schema = joi
  .object({
    save: joi.boolean(),
    install: joi.array().items(joi.object()),
    sync: joi.array().items(joi.object()),
    link: joi.boolean(),
    unlink: joi.array().items(joi.object()),
    commit: joi.object({
      message: joi.string(),
    }),
    overwrite: joi.bool(),
  })
  .xor('sync', 'install');

class BlockRunner {
  ctx: Context;
  scope = 'block';
  _builder: Partial<Builder> = {};
  config = nconf.get('block');
  interactiveLogger = new signale.Signale({
    interactive: true,
    scope: this.scope,
  });
  logger = new signale.Signale({
    interactive: false,
    scope: this.scope,
  });
  _listMap: Record<string, Block[]> = {};

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  getList = async (projectPath = this.ctx.BLOCK_PATH) => {
    if (this._listMap[projectPath]) return this._listMap[projectPath];
    const list: Block[] = [];
    const pkgs = (await new Promise((resolve, reject) => {
      glob(
        './src/pages/*/package.json',
        {
          cwd: projectPath,
        },
        (err, matchers) => {
          if (err) {
            reject(err);
          } else {
            resolve(matchers);
          }
        },
      );
    })) as string[];
    pkgs.forEach(item => {
      const pack = require(path.resolve(projectPath, item)) as BlockPackage;
      const [group, shortName] = pack.name.split('/');
      list.push({
        ...pack,
        group: group,
        shortName,
        type: 'block',
      });
    });
    this._listMap[projectPath] = list;
    return list;
  };

  syncList = async () => {
    const list = await this.getList();
    return list.filter(item => {
      return this.config.links[item.name];
    });
  };

  getProjectBlockDeps = async () => {
    return (await this.getList(this.ctx.PROJECT_PATH)).reduce<
      Record<string, string>
    >(
      (map, block) =>
        Object.assign(map, {
          [block.name]: `^${block.version}`,
        }),
      {},
    );
  };

  load = async () => {
    // 加载组件库
    if (!(await fse.pathExists(this.ctx.BLOCK_PATH))) {
      this.logger.await(`ready to download repository: ${this.config.url}`);
      await fse.mkdir(this.ctx.BLOCK_PATH);
      await execa('git', ['clone', this.config.url, '--depth', '1', '.'], {
        stdout: process.stdout,
        cwd: this.ctx.BLOCK_PATH,
      });
      this.logger.success('download done');
    } else {
      this.logger.await(`ready to update repository: ${this.config.url}`);
      await execa('git', ['pull'], {
        stdout: process.stdout,
        cwd: this.ctx.BLOCK_PATH,
      });
      this.logger.success('update done');
    }
  };

  clear = async () => {
    this.interactiveLogger.time('clear cache');
    await new Promise((resolve, reject) => {
      rimraf(this.ctx.BLOCK_PATH, error => {
        if (error) {
          reject(error);
        } else {
          resolve(undefined);
        }
      });
    });
    this.interactiveLogger.timeEnd('clear cache');
  };

  exec = async () => {
    schema.validate(this.ctx);
    if (this._builder.save) {
      nconf.set('block', this.config);
      await saveConfig();
    }
    if (this._builder.install) {
      let i = 0;

      for (const item of this._builder.install) {
        i += 1;
        this.logger.await(
          `[%d/${this._builder.install.length}] - 准备安装:  ${item.name}`,
          i,
        );
        // 如果存在同名文件且没有package.json则询问是否覆盖
        let hasItem = false;
        if (
          (await fse.pathExists(
            path.resolve(
              this.ctx.PROJECT_PATH,
              `./src/pages/${changeCase.pascalCase(item.shortName)}`,
            ),
          )) &&
          !(await fse.pathExists(
            path.resolve(
              this.ctx.PROJECT_PATH,
              `./src/pages/${changeCase.pascalCase(
                item.shortName,
              )}/package.json`,
            ),
          ))
        ) {
          hasItem = true;
        }
        if (hasItem) {
          if (this._builder.overwrite) {
            this.logger.warn(`出现了非组件的同名文件,覆盖 ${item.name}`);
            separator();
            await this._install(item);
          } else {
            this.logger.warn(`出现了非组件的同名文件,跳过 ${item.name}`);
            separator();
          }
        } else {
          await this._install(item);
        }
      }
      this.logger.success(`[%d/${this._builder.install.length}] - 安装结束`, i);
    }
    if (this._builder.sync) {
      const tasks = new Listr(
        this._builder.sync.map(item => {
          return {
            title: `同步组件: ${item.name}`,
            task: () => this._sync(item),
          };
        }),
        { concurrent: false, exitOnError: false },
      );
      await tasks
        .run()
        .then(() => {
          this.logger.success('组件同步完毕');
        })
        .catch(err => {
          (err.errors as string[]).forEach(error => {
            this.logger.error(error);
          });
        });
    }
    if (this._builder.link && this._builder.install) {
      const links = this.config.links;
      this._builder.install.forEach(item => {
        if (!links[item.name]) {
          links[item.name] = {
            project: {},
          };
        }
        links[item.name].project[this.ctx.PROJECT_PATH] = {};
        this.logger.success(
          `检测到link命令,建立依赖关系 ${item.name} -> ${this.ctx.PROJECT_PATH}`,
        );
      });
      nconf.set('block', this.config);
      await saveConfig();
    }
    if (this._builder.unlink) {
      const links = this.config.links;
      this._builder.unlink.forEach(item => {
        if (links[item.name]?.project[this.ctx.PROJECT_PATH]) {
          delete links[item.name].project[this.ctx.PROJECT_PATH];
          if (Object.keys(links[item.name].project).length < 1) {
            delete links[item.name];
          }
        }
        this.logger.success(
          `检测到unlink命令,删除依赖关系 ${item.name} -> ${this.ctx.PROJECT_PATH}`,
        );
      });
      nconf.set('block', this.config);
      await saveConfig();
    }
  };

  url = (url: string) => {
    this.config.url = url;
    return this;
  };

  save = () => {
    this._builder.save = true;
    return this;
  };

  install = (item: Block) => {
    if (!this._builder.install) {
      this._builder.install = [];
    }
    if (Array.isArray(item)) {
      this._builder.install.push(...item);
    } else {
      this._builder.install.push(item);
    }
    return this;
  };

  sync = (item: Block | Block[]) => {
    if (!this._builder.sync) {
      this._builder.sync = [];
    }
    if (Array.isArray(item)) {
      this._builder.sync.push(...item);
    } else {
      this._builder.sync.push(item);
    }
    return this;
  };

  link = () => {
    this._builder.link = true;
    return this;
  };

  unlink = (item: Block | Block[]) => {
    if (!this._builder.unlink) {
      this._builder.unlink = [];
    }
    if (Array.isArray(item)) {
      this._builder.unlink.push(...item);
    } else {
      this._builder.unlink.push(item);
    }
    return this;
  };

  commit = (message?: string) => {
    this._builder.commit = {
      message,
    };
    return this;
  };

  overwrite = () => {
    this._builder.overwrite = true;
  };

  _sync = (item: Block) => {
    const link = this.config.links[item.name] as Record<string, BaseLink>;
    return new Listr(
      Object.keys(link.project).map(projectPath => {
        return {
          title: `同步至: ${projectPath}`,
          task: () => {
            return new Observable(observer => {
              const myStream = ({
                fd: 1,
                write(text: string | Buffer) {
                  if (Buffer.isBuffer(text)) {
                    observer.next(text.toString('utf-8'));
                  } else {
                    observer.next(text);
                  }
                },
                removeListener() {},
                on() {},
                once() {},
                emit() {},
                end() {},
                writable: true,
              } as any) as WriteStream;
              const logger = new signale.Signale({
                scope: this.scope,
                interactive: false,
                stream: myStream,
              });
              this._install(item, projectPath, logger, 'update')
                .catch(err => {
                  observer.error(err);
                })
                .finally(() => {
                  observer.complete();
                });
            });
          },
        };
      }),
      { concurrent: true, exitOnError: false },
    );
  };

  _install = async (
    item: Block,
    projectPath = this.ctx.PROJECT_PATH,
    logger: signale.Signale = this.logger,
    action = 'install',
  ) => {
    const depsNum = Object.keys(item.dependencies).length;
    const qgDeps: string[] = [];
    const installDeps: [string, string][] = [];
    const updateDeps: [string, string][] = [];
    const { dependencies, devDependencies } = require(path.resolve(
      projectPath,
      'package.json',
    ));
    const comRunner = new ComRunner(this.ctx);
    const projectDeps = Object.assign(
      {},
      dependencies,
      devDependencies,
      await comRunner.getProjectComDeps(),
      await this.getProjectBlockDeps(),
    );

    if (depsNum) {
      logger.await(`[%d/${depsNum}] - 分析依赖`, 0);
      let i = 1;
      for (const depKey of Object.keys(item.dependencies)) {
        logger.await(`[%d/${depsNum}] - ${depKey}`, i);

        if (projectDeps[depKey]) {
          if (
            compareVersions(
              projectDeps[depKey].replace(/\^/g, ''),
              item.dependencies[depKey].replace(/\^/g, ''),
            ) < 0
          ) {
            if (depKey.startsWith('@qg-')) {
              qgDeps.push(depKey);
            } else {
              updateDeps.push([
                depKey,
                item.dependencies[depKey].replace(/\^/g, ''),
              ]);
            }
          }
        } else {
          if (depKey.startsWith('@qg-')) {
            qgDeps.push(depKey);
          } else {
            installDeps.push([
              depKey,
              item.dependencies[depKey].replace(/\^/g, ''),
            ]);
          }
        }
        i += 1;
      }
      logger.success(`[%d/${depsNum}] - 依赖分析完毕`, depsNum);
    }
    // 全局依赖
    if (installDeps.length) {
      this.logger.warn(`需要下载依赖: ${installDeps.length}个`);
      installDeps.forEach(dep => {
        logger.info(`${dep[0]}@${dep[1]}`);
      });
    }
    if (updateDeps.length) {
      logger.warn(`需要更新依赖: ${updateDeps.length}个`);
      updateDeps.forEach(dep => {
        logger.info(`${dep[0]}@${dep[1]}`);
      });
    }
    if (qgDeps.length) {
      logger.warn(`需要安装其他组件: ${qgDeps.length}个`);
      qgDeps.forEach(dep => {
        logger.info(dep);
      });
    }

    if (installDeps.length || updateDeps.length) {
      const totalDeps = installDeps
        .concat(updateDeps)
        .map(dep => `${dep[0]}@${dep[1]}`);
      logger.await(`[%d/${totalDeps.length}] - 处理公共依赖`, 0);
      const npmProcess = execa('npm', ['install', '-S', ...totalDeps], {
        cwd: projectPath,
        all: true,
      });
      streamPrint(npmProcess.all, (logger as any).currentOptions.stream);
      await npmProcess;
      logger.success('公共依赖处理完毕');
    }
    if (qgDeps.length) {
      let i = 0;
      logger.await(`[%d/${qgDeps.length}] - 处理内部依赖`, i);
      for (const depKey of qgDeps) {
        i += 1;
        logger.await(`[%d/${qgDeps.length}] - ${depKey}`, i);
        let runner: BlockRunner | ComRunner;
        if (depKey.startsWith('@qg-block')) {
          runner = new BlockRunner(this.ctx);
        } else {
          runner = new ComRunner(this.ctx);
        }
        runner.scope = `${this.scope}->${item.name}`;
        runner.logger = new signale.Signale({
          scope: `${this.scope}->${item.name}`,
          interactive: true,
        });
        await runner.load();
        const target = ((await runner.getList()) as (Com | Block)[]).find(
          item => item.name === depKey,
        );
        if (!target) {
          throw Error(`找不到组件 ${depKey}`);
        }
        // 继承父级覆盖
        if (this._builder.overwrite) {
          runner.overwrite();
        }
        await runner.install(target as any).exec();
        separator();
      }
    }
    const files = await new Promise<string[]>((resolve, reject) => {
      return glob(
        `./src/pages/${changeCase.pascalCase(item.shortName)}`,
        {
          cwd: this.ctx.COM_PATH,
        },
        (error, matchs) => {
          if (error) {
            reject(error);
          } else {
            resolve(matchs);
          }
        },
      );
    });
    let i = 0;
    logger.await(`[%d/${files.length}] - 准备安装文件`, i);
    for (const filePath of files) {
      i += 1;
      logger.await(`[%d/${files.length}] - ${filePath}`, i);
      await fse.copy(
        path.resolve(this.ctx.BLOCK_PATH, filePath),
        path.resolve(projectPath, filePath),
      );
    }
    logger.success(`[${files.length}/${files.length}] - 安装完毕`);
    if (this._builder.commit) {
      logger.await('检测到自动提交');
      const addProcess = execa('git', ['add', '-A'], {
        cwd: projectPath,
        all: true,
      });
      streamPrint(addProcess.all, (logger as any).currentOptions.stream);
      await addProcess;
      const commitProcess = execa(
        'git',
        [
          'commit',
          '-m',
          this._builder.commit.message ||
            `chore(block): ${action} ${item.name}`,
        ],
        {
          cwd: projectPath,
          all: true,
        },
      );
      streamPrint(commitProcess.all, (logger as any).currentOptions.stream);
      await commitProcess;
      const pullProcess = execa('git', ['pull'], {
        cwd: projectPath,
        all: true,
      });
      streamPrint(pullProcess.all, (logger as any).currentOptions.stream);
      await pullProcess;
      const pushT = execa('git', ['push'], {
        cwd: projectPath,
        all: true,
      });
      streamPrint(pushT.all, (logger as any).currentOptions.stream);
      await pushT;
      logger.success(`提交完成`);
    }
  };
}

export default BlockRunner;
