#!/usr/bin/env node

import { Context } from '@xrkseek/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@xrkseek/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@xrkseek/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
