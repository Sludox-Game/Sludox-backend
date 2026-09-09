import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'provision')
    .default('development'),
  PORT: Joi.number().default(3001),
  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),

  // PostgreSQL Database
  DATABASE_HOST: Joi.string().default('localhost'),
  DATABASE_PORT: Joi.number().default(5432),
  DATABASE_USER: Joi.string().default('sludox'),
  DATABASE_PASSWORD: Joi.string().default('sludox_dev'),
  DATABASE_NAME: Joi.string().default('sludox'),

  // Redis / BullMQ
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('', null).optional(),

  // Stellar & Soroban RPC URLs
  SOROBAN_RPC_URL: Joi.string()
    .uri()
    .default('https://soroban-testnet.stellar.org'),
  STELLAR_HORIZON_URL: Joi.string()
    .uri()
    .default('https://horizon-testnet.stellar.org'),

  // Soroban Contract & Platform Signer
  CONTRACT_ID: Joi.string().allow('', null).optional(),
  PLATFORM_SIGNER_SECRET: Joi.string().allow('', null).optional(),
});
