import { envValidationSchema } from './env.validation';

describe('Environment Schema Validation (SG-B07)', () => {
  it('should validate valid environment variables and provide defaults', () => {
    const config = {
      NODE_ENV: 'test',
      PORT: '3001',
      DATABASE_HOST: 'localhost',
      DATABASE_PORT: '5432',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '6379',
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
      CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    };

    const { error, value } = envValidationSchema.validate(config);
    expect(error).toBeUndefined();
    expect(value.PORT).toBe(3001);
    expect(value.REDIS_PORT).toBe(6379);
    expect(value.DATABASE_PORT).toBe(5432);
  });

  it('should reject invalid NODE_ENV', () => {
    const config = {
      NODE_ENV: 'invalid_env',
    };

    const { error } = envValidationSchema.validate(config);
    expect(error).toBeDefined();
    expect(error?.message).toContain('"NODE_ENV" must be one of');
  });

  it('should reject malformed RPC URLs', () => {
    const config = {
      SOROBAN_RPC_URL: 'not-a-valid-uri',
    };

    const { error } = envValidationSchema.validate(config);
    expect(error).toBeDefined();
    expect(error?.message).toContain('"SOROBAN_RPC_URL" must be a valid uri');
  });

  it('should supply default values when optional fields are omitted', () => {
    const { error, value } = envValidationSchema.validate({});
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.PORT).toBe(3001);
    expect(value.REDIS_HOST).toBe('localhost');
    expect(value.REDIS_PORT).toBe(6379);
    expect(value.SOROBAN_RPC_URL).toBe('https://soroban-testnet.stellar.org');
    expect(value.STELLAR_HORIZON_URL).toBe('https://horizon-testnet.stellar.org');
  });
});
