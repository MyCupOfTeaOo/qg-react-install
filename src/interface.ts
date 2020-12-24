export interface Route {
  path: string;
  exact?: boolean;
  title?: string;
  component: string;
  Routes?: string[];
  routes?: Route[];
}

export interface BasePackage {
  name: string;
  version: string;
  feature: string;
  description: string;
  repository: {
    type: string;
    url: string;
  };
  license: string;
  dependencies: {
    [key: string]: string;
  };
}

export interface Com extends BasePackage {
  group: string;
  shortName: string;
  type: 'com' | 'util';
}

export interface BlockPackage extends BasePackage {
  main: string;
  Routes?: string[];
  exact?: boolean;
  routes?: Route[];
}

export interface Block extends BlockPackage {
  group: string;
  shortName: string;
  type: 'block';
}

export interface Context {
  PROJECT_PATH: string;
  COM_PATH: string;
  BLOCK_PATH: string;
  CONFIG_PATH: string;
}

export interface BaseLink {
  project: {
    [path: string]: {};
  };
}
