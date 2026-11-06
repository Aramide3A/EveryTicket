import 'reflect-metadata';
import { createApi } from './api.js';
import { readRuntimeConfig } from './config/runtime-config.js';

const config = readRuntimeConfig(process.env);

void createApi().then((app) => app.listen(config.port));
