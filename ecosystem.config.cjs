module.exports = {
  apps: [{
    name: 'unicorn-server',
    script: './dist/index.cjs',
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '400M',
    env: {
      NODE_ENV: 'production',
      PORT: '5000'
    },
    kill_timeout: 5000,
    listen_timeout: 10000,
    restart_delay: 2000
  }]
};
