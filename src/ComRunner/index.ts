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
import { Context, Com, BasePackage, BaseLink } from '../interface';
import { saveConfig, streamPrint, separator } from '../utils';
import Listr from 'listr';

interface Builder {
  save: boolean;
  install: Com[];
  sync: Com[];
  link: boolean;
  unlink: Com[];
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

class ComRunner {
  ctx: Context;
  scope = 'com';
  _builder: Partial<Builder> = {};
  config = nconf.get('com');
  interactiveLogger = new signale.Signale({
    interactive: true,
    scope: this.scope,
  });
  logger = new signale.Signale({
    interactive: false,
    scope: this.scope,
  });
  _listMap: Record<string, Com[]> = {};

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  getList = async (projectPath = this.ctx.COM_PATH) => {
    if (this._listMap[projectPath]) return this._listMap[projectPath];
    const list: Com[] = [];
    const pkgs = (await new Promise((resolve, reject) => {
      glob(
        './src/components/*/package.json',
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
      const pack = require(path.resolve(projectPath, item)) as BasePackage;
      const [group, shortName] = pack.name.split('/');
      list.push({
        ...pack,
        group: group,
        shortName,
        type: 'com',
      });
    });
    const utils = (await new Promise((resolve, reject) => {
      glob(
        './src/utils/*.package.json',
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
    utils.forEach(item => {
      const pack = require(path.resolve(projectPath, item)) as BasePackage;
      const [group, shortName] = pack.name.split('/');
      list.push({
        ...pack,
        group: group,
        shortName,
        type: 'util',
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

  getProjectComDeps = async () => {
    return (await this.getList(this.ctx.PROJECT_PATH)).reduce<
      Record<string, string>
    >(
      (map, com) =>
        Object.assign(map, {
          [com.name]: `^${com.version}`,
        }),
      {},
    );
  };

  load = async () => {
    // 加载组件库
    if (!(await fse.pathExists(this.ctx.COM_PATH))) {
      this.logger.await(`ready to download repository: ${this.config.url}`);
      await fse.mkdir(this.ctx.COM_PATH);
      await execa('git', ['clone', this.config.url, '--depth', '1', '.'], {
        stdout: process.stdout,
        cwd: this.ctx.COM_PATH,
      });
      this.logger.success('download done');
    } else {
      this.logger.await(`ready to update repository: ${this.config.url}`);
      await execa('git', ['pull'], {
        stdout: process.stdout,
        cwd: this.ctx.COM_PATH,
      });
      this.logger.success('update done');
    }
  };

  clear = async () => {
    this.interactiveLogger.time('clear cache');
    await new Promise((resolve, reject) => {
      rimraf(this.ctx.COM_PATH, error => {
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
      nconf.set('com', this.config);
      await saveConfig();
    }
    if (this._builder.install) {
      let i = 0;

      for (const com of this._builder.install) {
        i += 1;
        this.logger.await(
          `[%d/${this._builder.install.length}] - 准备安装:  ${com.name}`,
          i,
        );
        // 如果存在同名文件且没有package.json则询问是否覆盖
        let hasCom = false;
        if (
          com.type === 'com' &&
          (await fse.pathExists(
            path.resolve(
              this.ctx.PROJECT_PATH,
              `./src/components/${changeCase.pascalCase(com.shortName)}`,
            ),
          )) &&
          !(await fse.pathExists(
            path.resolve(
              this.ctx.PROJECT_PATH,
              `./src/components/${changeCase.pascalCase(
                com.shortName,
              )}/package.json`,
            ),
          ))
        ) {
          hasCom = true;
        }
        if (
          com.type === 'util' &&
          (await fse.pathExists(
            path.resolve(
              this.ctx.PROJECT_PATH,
              `./src/utils/${com.shortName}.ts`,
            ),
          )) &&
          !(await fse.pathExists(
            path.resolve(
              this.ctx.PROJECT_PATH,
              `./src/utils/${com.shortName}.package.json`,
            ),
          ))
        ) {
          hasCom = true;
        }
        if (hasCom) {
          if (this._builder.overwrite) {
            this.logger.warn(`出现了非组件的同名文件,覆盖 ${com.name}`);
            separator();
            await this._install(com);
          } else {
            this.logger.warn(`出现了非组件的同名文件,跳过 ${com.name}`);
            separator();
          }
        } else {
          await this._install(com);
        }
      }
      this.logger.success(`[%d/${this._builder.install.length}] - 安装结束`, i);
    }
    if (this._builder.sync) {
      const tasks = new Listr(
        this._builder.sync.map(com => {
          return {
            title: `同步组件: ${com.name}`,
            task: () => this._sync(com),
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
      this._builder.install.forEach(com => {
        if (!links[com.name]) {
          links[com.name] = {
            project: {},
          };
        }
        links[com.name].project[this.ctx.PROJECT_PATH] = {};
        this.logger.success(
          `检测到link命令,建立依赖关系 ${com.name} -> ${this.ctx.PROJECT_PATH}`,
        );
      });
      nconf.set('com', this.config);
      await saveConfig();
    }
    if (this._builder.unlink) {
      const links = this.config.links;
      this._builder.unlink.forEach(com => {
        if (links[com.name]?.project[this.ctx.PROJECT_PATH]) {
          delete links[com.name].project[this.ctx.PROJECT_PATH];
          if (Object.keys(links[com.name].project).length < 1) {
            delete links[com.name];
          }
        }
        this.logger.success(
          `检测到unlink命令,删除依赖关系 ${com.name} -> ${this.ctx.PROJECT_PATH}`,
        );
      });
      nconf.set('com', this.config);
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

  install = (com: Com) => {
    if (!this._builder.install) {
      this._builder.install = [];
    }
    if (Array.isArray(com)) {
      this._builder.install.push(...com);
    } else {
      this._builder.install.push(com);
    }
    return this;
  };

  sync = (com: Com | Com[]) => {
    if (!this._builder.sync) {
      this._builder.sync = [];
    }
    if (Array.isArray(com)) {
      this._builder.sync.push(...com);
    } else {
      this._builder.sync.push(com);
    }
    return this;
  };

  link = () => {
    this._builder.link = true;
    return this;
  };

  unlink = (com: Com | Com[]) => {
    if (!this._builder.unlink) {
      this._builder.unlink = [];
    }
    if (Array.isArray(com)) {
      this._builder.unlink.push(...com);
    } else {
      this._builder.unlink.push(com);
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

  _sync = (com: Com) => {
    const link = this.config.links[com.name] as Record<string, BaseLink>;
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
              this._install(com, projectPath, logger, 'update')
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
    com: Com,
    projectPath = this.ctx.PROJECT_PATH,
    logger: signale.Signale = this.logger,
    action = 'install',
  ) => {
    const depsNum = Object.keys(com.dependencies).length;
    const qgDeps: string[] = [];
    const installDeps: [string, string][] = [];
    const updateDeps: [string, string][] = [];
    const { dependencies, devDependencies } = require(path.resolve(
      projectPath,
      'package.json',
    ));
    const projectDeps = Object.assign(
      {},
      dependencies,
      devDependencies,
      await this.getProjectComDeps(),
    );

    if (depsNum) {
      logger.await(`[%d/${depsNum}] - 分析依赖`, 0);
      let i = 1;
      for (const depKey of Object.keys(com.dependencies)) {
        logger.await(`[%d/${depsNum}] - ${depKey}`, i);

        if (projectDeps[depKey]) {
          if (
            compareVersions(
              projectDeps[depKey].replace(/\^/g, ''),
              com.dependencies[depKey].replace(/\^/g, ''),
            ) < 0
          ) {
            if (depKey.startsWith('@qg-')) {
              qgDeps.push(depKey);
            } else {
              updateDeps.push([
                depKey,
                com.dependencies[depKey].replace(/\^/g, ''),
              ]);
            }
          }
        } else {
          if (depKey.startsWith('@qg-')) {
            qgDeps.push(depKey);
          } else {
            installDeps.push([
              depKey,
              com.dependencies[depKey].replace(/\^/g, ''),
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
        const runner = new ComRunner(this.ctx);
        runner.scope = `${this.scope}->${com.name}`;
        runner.logger = new signale.Signale({
          scope: `${this.scope}->${com.name}`,
          interactive: true,
        });
        const target = (await this.getList()).find(
          item => item.name === depKey,
        );
        if (!target) {
          throw Error(`找不到组件 ${depKey}`);
        }
        // 继承父级覆盖
        if (this._builder.overwrite) {
          runner.overwrite();
        }
        await runner.install(target).exec();
        separator();
      }
    }
    const files = await new Promise<string[]>((resolve, reject) => {
      if (com.type === 'com') {
        return glob(
          `./src/components/${changeCase.pascalCase(com.shortName)}`,
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
      } else {
        return glob(
          `./src/utils/{${com.shortName}.*,*/${com.shortName}.*,*/${com.shortName}}`,
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
      }
    });
    let i = 0;
    logger.await(`[%d/${files.length}] - 准备安装文件`, i);
    for (const filePath of files) {
      i += 1;
      logger.await(`[%d/${files.length}] - ${filePath}`, i);
      await fse.copy(
        path.resolve(this.ctx.COM_PATH, filePath),
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
          this._builder.commit.message || `chore(com): ${action} ${com.name}`,
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

export default ComRunner;
