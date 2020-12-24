import { program, Command } from 'commander';
import inquirer from 'inquirer';
import ctx from '../ctx';
import Runner from '.';
import { Block } from '../interface';

const myProgram = new Command('block');

myProgram
  .option('-i, --install', 'install block')
  .option('-u, --url <block_url>', 'block git repository url')
  .option('-c, --clear', 'clear block cache')
  .option('-s, --save', 'save config to local')
  .option('-l, --link', 'link project and save config')
  .option('-ul, --unlink', 'unlink project and save config')
  .option('--sync', 'sync block all link project')
  .option('-a, --auto-commit', 'auto commit git message')
  .option('-m, --message <commit_msg>', 'commit message')
  .option('-o, --overwrite', 'overwrite same name file')
  .action(async props => {
    const runner = new Runner(ctx);
    if (props.url) {
      runner.url(props.url);
    }
    if (props.clear) {
      await runner.clear();
    } else {
      await runner.load();
    }
    if (props.save) {
      runner.save();
    }

    if (props.link) {
      runner.link();
    }
    if (props.overwrite) {
      runner.overwrite();
    }
    if (props.unlink) {
      const list = await runner.syncList();
      const res = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'blockSelected',
          message: '请选择需要卸载的组件',
          choices: list.map(item => ({
            name: `${item.name}[${item.feature}](功能介绍: ${item.description})`,
            value: item,
            short: item.name,
          })),
          validate(items?: Block[]) {
            if (!items?.length) {
              return '至少选择一个组件';
            }
            return true;
          },
        },
      ]);
      runner.unlink(res.blockSelected);
    }
    if (props.autoCommit || props.message) {
      runner.commit(props.message);
    }
    if (props.sync) {
      const list = await runner.syncList();

      const res = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'blockSelected',
          message: '请选择需要同步的组件',
          choices: list.map(item => ({
            name: `${item.name}[${item.feature}](功能介绍: ${item.description})`,
            value: item,
            short: item.name,
          })),
          validate(items?: Block[]) {
            if (!items?.length) {
              return '至少选择一个组件';
            }
            return true;
          },
        },
      ]);
      runner.sync(res.blockSelected);
    }
    if (props.install) {
      const list = await runner.getList();
      const res = await inquirer.prompt([
        {
          type: 'list',
          name: 'blockSelected',
          message: '请选择需要安装的组件',
          choices: list.map(item => ({
            name: `${item.name}[${item.feature}](功能介绍: ${item.description})`,
            value: item,
            short: item.name,
          })),
        },
        {
          type: 'input',
          name: 'menuId',
          message: '请输入菜单id',
          validate(menuId?: string) {
            if (!menuId) {
              return '请输入菜单id';
            }
            return true;
          },
        },
      ]);
      runner.install(res.blockSelected, {
        menuId: res.menuId,
      });
    }
    await runner.exec();
  });

program.addCommand(myProgram);
