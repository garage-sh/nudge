import type { Options } from 'tsup';

declare function config(options?: Options): Options | Options[];
export = config;
