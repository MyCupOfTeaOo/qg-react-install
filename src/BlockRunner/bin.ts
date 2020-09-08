import { program, Command } from 'commander';

const myProgram = new Command('block');

myProgram
  .option('-u, --url <block_url>', 'block git repository url')
  .option('-c, --clear', 'clear block cache')
  .option('-s, --save', 'save config to local')
  .option('-l, --link', 'link project and save config')
  .option('-ul, --unlink', 'unlink project and save config')
  .option('--sync', 'sync block all link project')
  .option('--auto-commit', 'auto commit git message')
  .option('--config', 'show local config')
  .option('-m, --message <commit_msg>', 'commit message')
  .action((props) => {
    console.log('未完待续');
  });

program.addCommand(myProgram);
