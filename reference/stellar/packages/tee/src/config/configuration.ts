export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),

  stellar: {
    network: process.env.STELLAR_NETWORK || 'testnet',
    horizonUrl: process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
    friendbotUrl: process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org',
    namesContract: process.env.NAMES_CONTRACT || 'CDEMB3MAE62ZOCCKZPTYSXR5CS5WVENPOU5MDVK4PNKTZXFVDC74AFBV',
    announcerContract: process.env.ANNOUNCER_CONTRACT || 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL',
    usdcIssuer: process.env.USDC_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
  },

  database: (() => {
    const url = process.env.DATABASE_URL;
    if (url) {
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parseInt(parsed.port || '5432', 10),
        name: parsed.pathname.slice(1),
        user: parsed.username,
        password: parsed.password,
      };
    }
    return {
      host: process.env.DATABASE_HOST || 'db',
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      name: process.env.DATABASE_NAME || 'wraith',
      user: process.env.DATABASE_USER || 'wraith',
      password: process.env.DATABASE_PASSWORD || 'wraith',
    };
  })(),
});
