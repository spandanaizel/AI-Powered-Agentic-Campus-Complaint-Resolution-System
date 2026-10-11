// Runs before any module import, so src/config/env.js sees these values.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret-0123456789';
process.env.MONGODB_TEST_URI ||= 'mongodb://127.0.0.1:27017';
process.env.UPLOAD_DIR ||= `/tmp/ccrs-test-uploads-${process.pid}`;
process.env.ANTHROPIC_API_KEY = ''; // tests never call a real provider unless explicitly opted in
process.env.LOGIN_RATE_LIMIT_MAX ||= '5';
