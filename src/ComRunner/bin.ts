import { program, Command } from 'commander';
import inquirer from 'inquirer';
import Runner from './';
import ctx from '../ctx';
import { Com } from '../interface';

const myProgram = new Command('com');
myProgram
  .option('-i, --install', 'install com')
  .option('-u, --url <com_url>', 'com git repository url')
  .option('-c, --clear', 'clear com cache')
  .option('-s, --save', 'save com config to local')
  .option('-l, --link', 'link project and save config')
  .option('-ul, --unlink', 'unlink project and save config')
  .option('--sync', 'sync com all link project')
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
    if (props.unlink) {
      const comList = await runner.syncComList();
      const res = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'comSelected',
          message: '请选择需要卸载的组件',
          choices: comList.map(com => ({
            name: `${com.name}[${com.feature}](功能介绍: ${com.description})`,
            value: com,
            short: com.name,
          })),
          validate(blocks?: Com[]) {
            if (!blocks?.length) {
              return '至少选择一个组件';
            }
            return true;
          },
        },
      ]);
      runner.unlink(res.comSelected);
    }
    if (props.autoCommit || props.message) {
      runner.commit(props.message);
    }
    if (props.sync) {
      const comList = await runner.syncComList();

      const res = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'comSelected',
          message: '请选择需要同步的组件',
          choices: comList.map(com => ({
            name: `${com.name}[${com.feature}](功能介绍: ${com.description})`,
            value: com,
            short: com.name,
          })),
          validate(blocks?: Com[]) {
            if (!blocks?.length) {
              return '至少选择一个组件';
            }
            return true;
          },
        },
      ]);
      runner.sync(res.comSelected);
    }
    if (props.install) {
      const comList = await runner.comList();
      const res = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'comSelected',
          message: '请选择需要安装的组件',
          choices: comList.map(com => ({
            name: `${com.name}[${com.feature}](功能介绍: ${com.description})`,
            value: com,
            short: com.name,
          })),
          validate(blocks?: Com[]) {
            if (!blocks?.length) {
              return '至少选择一个组件';
            }
            return true;
          },
        },
      ]);
      runner.install(res.comSelected);
    }
    await runner.exec();
  });

program.addCommand(myProgram);
