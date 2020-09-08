import { ThroughStream } from 'through';

interface SplitOptions {
  maxLength?: number;
  trailing?: boolean;
}

declare function split(
  matcher?: any,
  mapper?: any,
  options?: SplitOptions,
): ThroughStream;

export = split;
