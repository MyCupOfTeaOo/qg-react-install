export interface ComPackage {
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

export interface Com extends ComPackage {
  group: '@qg-com' | '@qg-util';
}

export interface Context {
  PROJECT_PATH: string;
  COM_PATH: string;
  BLOCK_PATH: string;
  CONFIG_PATH: string;
}

export interface ComLink {
  project: {
    [path: string]: {};
  };
}
