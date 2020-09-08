#!/usr/bin/env node
import { program } from 'commander';
import nconf from 'nconf';
import signale from 'signale';
import fse from 'fs-extra';
import ctx from './ctx';
import './ComRunner/bin';
import './BlockRunner/bin';

program.version('0.0.1');
program.option('--config', 'show local config');
if (!fse.existsSync(ctx.CONFIG_PATH)) {
  signale.info('初始化配置文件');
  fse.copySync(ctx.SOURCE_CONFIG, ctx.CONFIG_PATH);
}
nconf.argv().env().file({ file: ctx.CONFIG_PATH });
program.parse(process.argv);
