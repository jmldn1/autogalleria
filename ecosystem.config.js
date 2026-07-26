module.exports = {
  apps: [
    {
      name: "neptune",
      script: "./index.js",
      watch: false,          // disable auto-restart on file changes in production
      instances: 1,          // 1 instance for now, can use 'max' for cluster mode
      autorestart: true,
      restart_delay: 5000,   // wait 5 seconds before restart if it crashes
      max_memory_restart: "500M",
      merge_logs: true,      // merge stdout and stderr
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      env: {
        NODE_ENV: "production",
        PORT: 4000,
        MONGO_URI: process.env.MONGO_URI,        // your Atlas URI
        SESSION_SECRET: process.env.SESSION_SECRET,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        OPENAI_SECRET_KEY: process.env.OPENAI_SECRET_KEY,
        OPENAI_MODEL: process.env.OPENAI_MODEL
      },
      error_file: "/var/www/neptune/logs/pm2/neptune-error.log",
      out_file: "/var/www/neptune/logs/pm2/neptune-out.log",
    }
  ]
};
