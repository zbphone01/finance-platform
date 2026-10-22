module.exports = {
  apps: [{
    name: 'finance-platform',
    script: './dist/boot.js',
    cwd: '/home/ubuntu/finance-platform',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      // DATABASE_URL 从 .env 文件读取，不要在这里配置
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
