const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

function cacheMiddleware(req, res, next) {
  const key = req.originalUrl;
  const cached = cache.get(key);
  if (cached !== undefined) {
    console.log(`✅ Caché hit: ${key}`);
    return res.json(cached);
  }
  
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      cache.set(key, body);
    }
    return originalJson(body);
  };
  next();
}

module.exports = { cacheMiddleware };
