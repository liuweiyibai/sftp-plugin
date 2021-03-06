const fs = require('fs');
const glob = require('glob');
const Client = require('ssh2-sftp-client');
const chalk = require('chalk');

const redLog = function () {
  console.log.call(null, chalk.red([...arguments]));
};

const greenLog = function () {
  console.log.call(null, chalk.green([...arguments]));
};

const blueLog = function () {
  console.log.call(null, chalk.blue([...arguments]));
};

const genMissionTime = (ms) => {
  const min = Math.floor((ms / 1000 / 60) << 0);
  const sec = Math.floor((ms / 1000) % 60);
  return min + 'min:' + sec + 'sec';
};

const sftp = new Client();

/***
 * 路径结尾要添加  '/'
 */
class SftpPlugin {
  // localDir 本地目录格式 path.join(__dirname, '..', 'dist/')
  constructor({
    localDir = './dist/',
    remoteDir = '/www/',
    host = '192.168.0.1',
    port = '22',
    username = 'username',
    password = 'password',
    readyTimeout = 20000,
    filterFile = null,
  } = {}) {
    this.remoteDir = remoteDir;
    this.localDir = localDir;
    this.filterFile = filterFile;
    this.startTime = null;
    this.endTime = null;
    this.config = {
      host,
      port,
      username,
      password,
      readyTimeout,
    };
  }

  async start() {
    this.startTime = new Date().getTime(); // 开始时间
    await this.put();
  }

  end() {
    this.endTime = new Date().getTime();
    const timeDiff = this.endTime - this.startTime;
    const time = genMissionTime(timeDiff);
    blueLog(`任务耗时:${time}`);
  }

  put() {
    // 自动上传到FTP服务器
    if (!this.localDir) {
      redLog('无法上传SFTP,请检查参数');
      return;
    }

    // 连接服务器
    const connect = () =>
      new Promise((resolve, reject) => {
        sftp
          .connect(this.config)
          .then(() => {
            blueLog(`连接成功...`);
            resolve();
          })
          .catch((err) => {
            this.exError('sftp 连接失败' + err);
            reject(err);
          });
      });

    // 列出远程文件
    const listRemoteDir = () =>
      new Promise((resolve, reject) => {
        sftp
          .list(this.remoteDir)
          .then((list) => {
            redLog(`正在清理文件...`);
            resolve(list);
          })
          .catch((err) => {
            this.exError(err);
            reject(err);
          });
      });

    // 删除远程文件
    const deleteRemoteDir = (list) =>
      new Promise((resolve) => {
        this.delete(list).then(() => {
          resolve();
        });
      });

    // 上传本地文件
    const uploadLocalFiles = () =>
      new Promise((resolve) => {
        blueLog(`开始上传文件...`);
        this.globLocalFile().then(() => {
          resolve();
        });
      });

    // 返回 Promise 调用，方便和其他任务并行
    return new Promise((resolve) => {
      // promise 链式调用
      Promise.resolve()
        .then(connect)
        .then(listRemoteDir)
        .then(deleteRemoteDir)
        .then(uploadLocalFiles)
        .then(resolve);
    });
  }

  async delete(list) {
    if (list.length === 0) return;
    // 删除服务器上文件(夹)
    for (const fileInfo of list) {
      const path = this.remoteDir + fileInfo.name;
      redLog(`deleting file: ${path}`);
      if (fileInfo.type === '-') {
        await sftp.delete(path);
      } else {
        await sftp.rmdir(path, true);
      }
    }
  }

  globLocalFile() {
    return new Promise((resolve, reject) => {
      // 获取本地路径所有文件
      const folder = this.localDir + `**`;
      glob(folder, (er, files) => {
        // 本地目录下所有文件(夹)的路径
        if (er) {
          reject(er);
        } else {
          files.splice(0, 1); // 删除路径../dist/

          if (this.filterFile && typeof this.filterFile === 'function') {
            files = files.filter((x) => this.filterFile(x));
          }

          this.upload(files)
            .then(() => {
              resolve();
            })
            .catch((err) => {
              reject(err);
            });
        }
      });
    });
  }

  async upload(files) {
    // 传输文件到服务器
    for (const localSrc of files) {
      const targetSrc = localSrc.replace(
        this.localDir.replace(/\\/g, '/'),
        this.remoteDir
      );

      if (fs.lstatSync(localSrc).isDirectory()) {
        // 是文件夹
        await sftp.mkdir(targetSrc);
      } else {
        await sftp.put(localSrc, targetSrc);
      }
      greenLog(`uploading: ${localSrc}->${targetSrc}`);
    }

    blueLog('已上传至SFTP服务器!');

    sftp.end();
    this.end();
  }

  // 出错请调用此方法
  exError(err) {
    sftp.end();
    redLog('sftpError:', err);
  }
}

module.exports = SftpPlugin;
