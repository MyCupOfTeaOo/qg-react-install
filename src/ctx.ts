import path from 'path';
import os from 'os';
import pkgDir from 'pkg-dir';

const PROJECT_PATH = pkgDir.sync(path.resolve());

if (!PROJECT_PATH) {
  throw Error(`当前路径向上查找项目根路径失败: ${__dirname}`);
}

export default {
  BLOCK_PATH: path.resolve(__dirname, './block'),
  COM_PATH: path.resolve(__dirname, './com'),
  SOURCE_CONFIG: path.resolve(__dirname, './config.json'),
  CONFIG_PATH: path.join(os.homedir(), '.qg-react-install', './config.json'),
  PROJECT_PATH: PROJECT_PATH,
};
