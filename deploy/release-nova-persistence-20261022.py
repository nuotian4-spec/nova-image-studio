#!/usr/bin/env python3
"""Nova 单服务定向发布：锁定产品、自动排空、停机备份；失败保留现场。"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import time

ROOT = Path('/opt/sub2api')
COMPOSE = ROOT / 'docker-compose.yml'
ENV = ROOT / '.env'
LOCK = ROOT / '.upgrade-custom.lock.d'
CONTAINER = 'sub2api-nova-studio'
SERVICE = 'nova-studio'
PROJECT = 'sub2api'
HOST_SHA = '2279232df3562c53c1b23b8a891fd10daa0ae2c6'
HOST_SOURCE_SHA = 'a56afbdcf679b446084fa2578cfa91a6b71b0955'
OLD_SHA = '2c003604a06f1828d1c7d677d341c148154a68c9'
OLD_IMAGE = 'sha256:ed899f297fa72d449609e1bd0d40726d00806b18a60856a7bc486ec6c4b7181a'
OLD_CONTAINER = 'e17a5c41b020ed3789dcc927dfc5f75b4100e894e2b48680f7bfad763761d1d0'
TARGET = '5c15abcdda516cdf15f80a71c777ccef9a6d649d'
TARGET_BRANCH = 'codex/nova-image-persistence-20261022'
OLD_SERVER = '16274ab2a725be6dd997f12ce7ed26cc9beb97fa6438d123751a8edfb0f02e0f'
NEW_SERVER = '16274ab2a725be6dd997f12ce7ed26cc9beb97fa6438d123751a8edfb0f02e0f'
NEW_PARSER = '8da4d38bf1de8630f673c258a96a17c498fc6bf9fab82c69e8260feb44855620'
DATA = '/app/backend/data'
VOLUME = '/var/lib/docker/volumes/sub2api_nova_studio_data/_data'
DC = ['docker', 'compose', '--project-name', PROJECT, '--project-directory', str(ROOT), '--env-file', str(ENV), '-f', str(COMPOSE)]

STATIC_CHECK = r"""
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const root='/app/frontend/out';const revision=fs.readFileSync(root+'/release-revision.txt','utf8').trim();
assert(fs.statSync(root+'/index.html').isFile());assert(fs.statSync(root+'/_next/static').isDirectory());
for(const [name,hash] of Object.entries({SERVER_HASHES}))assert.equal(crypto.createHash('sha256').update(fs.readFileSync('/app/backend/'+name)).digest('hex'),hash);
const rows=[];function walk(p){for(const name of fs.readdirSync(p).sort()){const full=path.join(p,name),s=fs.lstatSync(full);assert(!s.isSymbolicLink());if(s.isDirectory())walk(full);else{assert(s.isFile());rows.push([path.relative(root,full),crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')]);}}}walk(root);
console.log(JSON.stringify({revision,files:rows.length,sha256:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')}));
""".replace('{SERVER_HASHES}', json.dumps({'server.js': NEW_SERVER, 'gemini-image-response.js': NEW_PARSER}))


def validate_product_diff(paths):
    require(bool(paths), '固定候选没有前端差异')
    require(all(path.startswith('frontend/src/') and '..' not in Path(path).parts for path in paths),
            '固定候选包含非前端源码变化；不得复用旧后端或构建配置')


def build_dockerfile(base):
    # builder继承固定旧镜像的Node/npm，但全部前端输入来自固定候选。
    # 最终阶段从同一旧镜像开始，只替换完整静态导出目录，保留后端与运行配置。
    return ('FROM ' + base + ' AS frontend-builder\n'
            'WORKDIR /nova-build\n'
            'COPY package.json package-lock.json ./\n'
            'COPY frontend/ ./frontend/\n'
            'RUN cd frontend && npm ci --include=dev && npm run build\n'
            'RUN test -f frontend/out/index.html && test -d frontend/out/_next/static\n'
            "RUN printf '%s\\n' '" + TARGET + "' > frontend/out/release-revision.txt\n"
            'FROM ' + base + '\n'
            'RUN rm -rf /app/frontend/out\n'
            'COPY --from=frontend-builder /nova-build/frontend/out/ /app/frontend/out/\n'
            'LABEL org.opencontainers.image.revision="' + TARGET + '"\n'
            'LABEL sub2api.release.base-image="' + OLD_IMAGE + '"\n')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def identity(path):
    st = path.lstat()
    require(stat.S_ISREG(st.st_mode), '文件不是普通文件：' + str(path))
    return (digest(path.read_bytes()), st.st_dev, st.st_ino)


def compare_compose(before, after, new_image):
    expected = json.loads(json.dumps(before))
    expected['services'][SERVICE]['image'] = new_image
    require(after == expected, 'Compose 语义出现非 Nova image 改动，停止')


def validate_diff(text, paths):
    defaults = {'/app/.env', '/app/backend/prompts.json', '/app/backend/blacklist.json', '/app/backend/plugins'}
    defaults.update(paths.values())
    ancestors = {str(Path(p).parent) for p in defaults}
    ancestors.update({'/app', '/app/backend', '/tmp'})
    for line in text.splitlines():
        require(len(line) > 2 and line[1] == ' ', 'docker diff 格式异常')
        action, path = line[0], line[2:]
        inside = any(path == p or path.startswith(p + '/') for p in defaults)
        volatile = path == '/tmp' or path.startswith('/tmp/') or path == DATA or path.startswith(DATA + '/')
        require(action in {'A', 'C', 'D'}, 'docker diff 动作异常')
        if action == 'D' and (inside or path in ancestors):
            raise RuntimeError('配置或插件存在删除项，不能合并恢复：' + path)
        require(inside or volatile or (action != 'D' and path in ancestors), '存在未识别容器可写层改动：' + path)


def runtime_equivalent(old, new):
    for key in ['Cmd', 'Entrypoint', 'WorkingDir', 'User', 'StopSignal', 'Healthcheck', 'ExposedPorts', 'Volumes']:
        require(old.get('Config', {}).get(key) == new.get('Config', {}).get(key), '新容器运行配置变化：' + key)
    require(sorted(old.get('Config', {}).get('Env') or []) == sorted(new.get('Config', {}).get('Env') or []), '新容器环境配置变化')
    for key in ['RestartPolicy', 'NetworkMode', 'PortBindings', 'Privileged', 'ReadonlyRootfs', 'CapAdd', 'CapDrop', 'SecurityOpt', 'Memory', 'MemorySwap', 'NanoCpus', 'CpuShares', 'Binds']:
        require(old.get('HostConfig', {}).get(key) == new.get('HostConfig', {}).get(key), '新容器宿主配置变化：' + key)


def manifest(path):
    require(not path.is_symlink(), '配置备份含符号链接')
    if path.is_file():
        return {'file': digest(path.read_bytes())}
    require(path.is_dir(), '配置备份类型异常')
    result = {}
    for item in sorted(path.rglob('*')):
        require(not item.is_symlink(), '配置备份含符号链接')
        require(item.is_file() or item.is_dir(), '配置备份含特殊文件')
        result[str(item.relative_to(path))] = digest(item.read_bytes()) if item.is_file() else 'directory'
    return result


class Release:
    def __init__(self):
        self.save = None
        self.phase = '尚未变更'
        self.locked = False
        self.log = None
        self.shared_fd = None
        self.lock_identity = None

    def run(self, args, *, input=None, interactive=False, cwd=None, check=True, timeout=180):
        # Git 登录继承 TTY；凭据不被 Python 捕获、回显或写入日志。
        result = subprocess.run(args, input=input, cwd=cwd, stdout=None if interactive else subprocess.PIPE,
                                stderr=None if interactive else subprocess.PIPE, timeout=timeout)
        if self.log and not interactive:
            self.log.write(result.stdout or b'')
            self.log.write(result.stderr or b'')
            self.log.flush()
        if check:
            detail = '详细输出在私有日志' if self.log else '发布日志尚未创建；命令内容不回显'
            require(result.returncode == 0,
                    f'命令失败：{Path(args[0]).name}，退出码={result.returncode}，阶段={self.phase}（{detail}）')
        return result

    def out(self, args, **kwargs):
        return self.run(args, **kwargs).stdout.decode().strip()

    def inspect(self, name):
        return json.loads(self.out(['docker', 'inspect', name]))[0]

    def node(self, script, *args, input=None):
        return self.out(['docker', 'exec', '-i', CONTAINER, 'node', '-e', script, *args], input=input)

    def checkpoint(self, phase, **values):
        if self.locked:
            st = LOCK.lstat()
            require(stat.S_ISDIR(st.st_mode) and (st.st_dev, st.st_ino) == self.lock_identity, '发布目录锁身份变化')
        self.phase = phase
        self.state.update(values)
        self.state['phase'] = phase
        target = self.save / 'state.json'
        tmp = self.save / 'state.json.tmp'
        tmp.write_text(json.dumps(self.state, ensure_ascii=False, indent=2) + '\n')
        os.replace(tmp, target)
        print(phase, flush=True)

    def snapshot_other(self):
        ids = self.out(DC + ['ps', '-a', '-q']).splitlines()
        return {item['Name']: item['Id'] for item in (self.inspect(i) for i in ids) if item['Name'] != '/' + CONTAINER}

    def queue(self):
        return json.loads(self.node("fetch('http://127.0.0.1:3000/api/nova/queue-status',{signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)throw Error('http');console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(1))"))

    def verify_others(self):
        require(self.snapshot_other() == self.others, '其他服务容器身份变化，停止')
        host = self.inspect('sub2api')
        require(host['Config']['Labels'].get('org.opencontainers.image.revision') == HOST_SHA, 'Host 不是固定基线')

    def verify_mounts(self, item):
        require(item['Mounts'] == self.old['Mounts'], 'Nova 挂载变化，停止')

    def execute(self):
        require(os.name == 'posix' and os.geteuid() == 0, '仅在生产服务器 root Linux 执行')
        os.umask(0o077)
        require(ROOT.is_dir() and not ROOT.is_symlink(), 'Compose 目录异常')
        import fcntl
        self.shared_fd = os.open(ROOT / '.release-tps-dual.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        require(stat.S_ISREG(os.fstat(self.shared_fd).st_mode), '共享锁不是普通文件')
        os.set_inheritable(self.shared_fd, False)
        fcntl.flock(self.shared_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for name in ('.upgrade-custom.lock.d', '.release-sub4api.lock.d', '.release-usage-tps.lock.d'):
            path = ROOT / name
            require(not path.exists() and not path.is_symlink(), '存在发布目录锁；不要删除：' + name)
        scheduler = ROOT / '.upgrade-schedulers.json'
        if scheduler.exists() or scheduler.is_symlink():
            identity(scheduler)
            require(json.loads(scheduler.read_text()).get('phase') == 'complete', '父站调度尚未收口')
        require(self.out(['git', '-C', '/opt/sub2api-custom', 'rev-parse', 'HEAD']) == HOST_SOURCE_SHA, '父站源码基线不符')
        self.compose_id, self.env_id = identity(COMPOSE), identity(ENV)
        self.old = self.inspect(CONTAINER)
        require(self.old['State']['Running'], 'Nova 未运行')
        require(self.old['Image'] == OLD_IMAGE and self.old['Id'] == OLD_CONTAINER, 'Nova不是预检固定容器及镜像')
        labels = self.old['Config'].get('Labels') or {}
        require(labels.get('com.docker.compose.project') == PROJECT and labels.get('com.docker.compose.service') == SERVICE, 'Nova Compose 归属不符')
        require(labels.get('org.opencontainers.image.revision') == OLD_SHA, 'Nova 运行提交不是固定旧基线')
        mounts = self.old['Mounts']
        require(len(mounts) == 1 and mounts[0]['Type'] == 'volume' and mounts[0].get('Name') == 'sub2api_nova_studio_data' and mounts[0]['Destination'] == DATA and mounts[0]['Source'] == VOLUME and mounts[0]['RW'], 'Nova 数据挂载不符')
        version = self.node('console.log(process.versions.node)')
        require(version.startswith('22.'), 'Nova Node 不是22')
        require(self.node("console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('/app/backend/server.js')).digest('hex'))") == OLD_SERVER, '运行 server.js 不符')
        self.others = self.snapshot_other()
        self.verify_others()
        require(self.old['Config'].get('StopSignal', '') in ('', 'SIGTERM', '15'), 'Nova配置了未知停止信号')
        original_queue = self.queue()
        require(original_queue['acceptingNewTasks'] is True, '当前并非已确认接受状态，停止')
        self.phase = '校验Nova数据与配置路径'
        config_script = r"""
const fs=require('fs'),path=require('path');const envPath=process.env.NOVA_ENV_FILE||'/app/.env';let env={...process.env};
if(fs.existsSync(envPath))for(const line of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const t=line.trim(),i=t.indexOf('=');if(!t||t.startsWith('#')||i<=0)continue;env[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^['"]|['"]$/g,'');}
const p={env:envPath,prompts:env.NOVA_PROMPTS_PATH||'/app/backend/prompts.json',blacklist:'/app/backend/blacklist.json',plugins:env.NOVA_PLUGINS_DIR||'/app/backend/plugins',media:env.NOVA_PLUGIN_MEDIA_DIR||'/app/backend/data/plugin-media'};
// 数据路径与Nova启动规则一致：容器环境优先，相对路径基于进程cwd。
const startup={...env,...process.env};
const dbPath=path.resolve(process.cwd(),startup.NOVA_TASK_DB||'/app/backend/nova-tasks.sqlite');
const imagePath=path.resolve(process.cwd(),startup.NOVA_IMAGE_DIR||'/app/backend/nova-images');
if(dbPath!=='/app/backend/data/nova-tasks.sqlite'||imagePath!=='/app/backend/data/nova-images')process.exit(2);
function safe(p){let parent=p;while(!fs.existsSync(parent))parent=path.dirname(parent);if(fs.realpathSync(parent)!==path.resolve(parent))throw Error('symlink parent');if(!fs.existsSync(p))return;const s=fs.lstatSync(p);if(s.isSymbolicLink()||(!s.isFile()&&!s.isDirectory()))throw Error('unsafe');if(s.isDirectory())for(const x of fs.readdirSync(p))safe(path.join(p,x));}
for(const x of Object.values(p))safe(x);console.log(JSON.stringify(p));
"""
        self.paths = json.loads(self.node(config_script))
        self.path_exists = json.loads(self.node("const fs=require('fs');const p=JSON.parse(process.argv[1]);console.log(JSON.stringify(Object.fromEntries(Object.entries(p).map(([k,v])=>[k,fs.existsSync(v)]))))", json.dumps(self.paths)))
        defaults = {'env': '/app/.env', 'prompts': '/app/backend/prompts.json', 'blacklist': '/app/backend/blacklist.json', 'plugins': '/app/backend/plugins', 'media': DATA + '/plugin-media'}
        for key, path in self.paths.items():
            require(path == defaults[key] or path.startswith(DATA + '/'), '未确认自定义配置路径：' + key)
            require('/../' not in path and '/./' not in path, '配置路径未规范化')
        validate_diff(self.out(['docker', 'diff', CONTAINER]), self.paths)
        before = json.loads(self.out(DC + ['config', '--format', 'json']))
        require(before['services'][SERVICE].get('container_name') == CONTAINER, '容器名配置不符')
        require(before['services'][SERVICE]['image'] == self.old['Config']['Image'], '持久镜像与运行镜像不符')
        backups = ROOT / 'backups'
        require(backups.is_dir() and not backups.is_symlink(), '备份目录异常')
        size = int(self.out(['du', '-sb', VOLUME]).split()[0])
        require(shutil.disk_usage(backups).free > size + 8 * 1024 ** 3, '备份空间不足（数据原大小加8GiB构建余量）')
        LOCK.mkdir(mode=0o700)
        self.locked = True
        st = LOCK.lstat()
        self.lock_identity = (st.st_dev, st.st_ino)
        self.save = Path(tempfile.mkdtemp(prefix='nova-persistence-release.', dir=backups))
        self.log = (self.save / 'private.log').open('ab')
        self.state = {'old_image': self.old['Image'], 'old_tag': self.old['Config']['Image'], 'old_container': self.old['Id'], 'target': TARGET, 'helper_sha256': digest(Path(__file__).read_bytes()), 'host_source': HOST_SOURCE_SHA, 'host_runtime': HOST_SHA, 'paths': self.paths, 'others': self.others, 'compose_identity': self.compose_id}
        self.checkpoint('已锁定发布基线，尚未暂停')
        (self.save / 'RECOVERY.txt').write_text(
            '失败恢复说明（不得盲目执行）\n'
            '1. 先看state.json的phase、old_image/new_image与docker inspect实际容器；不要清升级锁。\n'
            '2. 如果旧Nova仍运行且只是热暂停：确认健康后，env_existed=true时用docker cp -a恢复container.env.before到state.paths.env；原本不存在则仅移除本次创建的该.env。等待1秒后核queue-status接受状态。\n'
            '3. 若已停止或已替换：保留数据卷，用state.old_tag恢复仅Nova镜像。先创建停止态容器，将原.env和config_backups恢复原路径后再start；禁止把临时reject配置带入启动。\n'
            '4. 恢复Compose前核文件当前hash/inode对应compose.production.result或state.new_compose_identity；有并发改动不可整份覆盖。\n'
            '5. nova-data.before.tar.gz是停机完整备份；回旧镜像不需要回灌。禁止自动覆盖升级后新增图片/任务。\n'
            '6. 核Host及其他容器未变、Nova挂载/健康/页面/queue状态后再人工收口锁，保留本目录。\n', encoding='utf-8')
        print('备份与失败恢复资料：' + str(self.save), flush=True)
        shutil.copy2(COMPOSE, self.save / 'docker-compose.before.yml')
        shutil.copy2(ENV, self.save / 'host.env.before')
        (self.save / 'container.before.json').write_text(json.dumps(self.old))
        # 全部备份私有，不将环境配置写入构建上下文或Docker镜像。
        env_path = self.paths['env']
        env_exists = self.node("console.log(require('fs').existsSync(process.argv[1]))", env_path) == 'true'
        self.original_env = self.run(['docker', 'exec', CONTAINER, 'cat', env_path]).stdout if env_exists else b''
        if env_exists:
            self.run(['docker', 'cp', '-a', CONTAINER + ':' + env_path, str(self.save / 'container.env.before')])
            require((self.save / 'container.env.before').read_bytes() == self.original_env, '备份期间原.env变化')
        else:
            (self.save / 'container.env.before').write_bytes(b'')
        self.state['env_existed'] = env_exists
        self.fetch_build()
        require(identity(COMPOSE) == self.compose_id and identity(ENV) == self.env_id, '构建期间配置被修改')
        require(self.inspect(CONTAINER)['Id'] == self.old['Id'], '构建期间容器变化')
        validate_diff(self.out(['docker', 'diff', CONTAINER]), self.paths)
        self.verify_others()
        self.checkpoint('准备热暂停Nova新任务')
        pause_script = r"""
const fs=require('fs'),crypto=require('crypto');const p=process.argv[1],exists=fs.existsSync(p),old=exists?fs.readFileSync(p):Buffer.alloc(0);
if(crypto.createHash('sha256').update(old).digest('hex')!==process.argv[2])process.exit(2);
const st=exists?fs.statSync(p):null,tmp=p+'.nova-release.tmp';fs.writeFileSync(tmp,Buffer.concat([old,Buffer.from('\nNOVA_REJECT_NEW_TASKS=1\n')]),{mode:st?st.mode:0o600,flag:'wx'});if(st){fs.chownSync(tmp,st.uid,st.gid);fs.chmodSync(tmp,st.mode);}fs.renameSync(tmp,p);
"""
        self.node(pause_script, env_path, digest(self.original_env))
        self.checkpoint('Nova新任务已暂停，等待排空')
        deadline, zero_since = time.monotonic() + 300, None
        while time.monotonic() < deadline:
            q = self.queue()
            if q['acceptingNewTasks'] is False and q['pendingCount'] == 0:
                zero_since = zero_since or time.monotonic()
                if time.monotonic() - zero_since >= 3:
                    break
            else:
                zero_since = None
            time.sleep(1)
        else:
            raise RuntimeError('300秒内未排空；保持维护，不停止容器')
        self.checkpoint('已排空，发送TERM（禁止强杀）')
        # 无限Docker grace禁止daemon强杀，90秒只限制本脚本等待；超时仅终止CLI。
        stopper = subprocess.Popen(['docker', 'stop', '--timeout', '-1', CONTAINER], stdout=self.log, stderr=self.log)
        try:
            require(stopper.wait(timeout=90) == 0, 'Docker停止命令失败')
        except subprocess.TimeoutExpired:
            stopper.terminate()
            raise RuntimeError('Nova90秒内未正常退出；仅结束等待客户端，不强杀，不继续替换')
        stopped = self.inspect(CONTAINER)['State']
        require(not stopped['Running'] and stopped['ExitCode'] == 0 and not stopped.get('OOMKilled'), 'Nova未正常退出；禁止强杀或继续替换')
        validate_diff(self.out(['docker', 'diff', CONTAINER]), self.paths)
        paused = self.save / 'container.env.paused-check'
        self.run(['docker', 'cp', CONTAINER + ':' + env_path, str(paused)])
        require(paused.read_bytes() == self.original_env + b'\nNOVA_REJECT_NEW_TASKS=1\n', '暂停后.env被并发修改，停止')
        self.checkpoint('Nova已正常停止，备份SQLite与图片')
        self.run(['tar', '--numeric-owner', '-czf', str(self.save / 'nova-data.before.tar.gz'), '-C', VOLUME, '.'], timeout=900)
        self.run(['tar', '-tzf', str(self.save / 'nova-data.before.tar.gz')], timeout=900)
        require((self.save / 'nova-data.before.tar.gz').stat().st_size > 0, '数据备份为空')
        self.config_exists = {}
        for key, path in self.paths.items():
            if key == 'env' or path.startswith(DATA + '/'):
                continue
            destination = self.save / ('config-' + key)
            result = self.run(['docker', 'cp', '-a', CONTAINER + ':' + path, str(destination)], check=False)
            if result.returncode != 0:
                missing = ('Could not find the file ' + path + ' in container').encode()
                require(missing in (result.stderr or b''), '配置备份失败：' + key)
                continue
            manifest(destination)
            self.config_exists[key] = str(destination)
        self.checkpoint('备份完成，准备仅替换Nova', config_backups=self.config_exists)
        self.switch(before)
        self.checkpoint('Nova升级完成，原接受状态已恢复')
        self.log.close()
        st = LOCK.lstat()
        require(stat.S_ISDIR(st.st_mode) and (st.st_dev, st.st_ino) == self.lock_identity, '发布锁身份变化；保留锁')
        LOCK.rmdir()
        self.locked = False
        print('Nova提交：' + TARGET + '；Host及其他容器未变。无PG迁移。')
        print('备份：' + str(self.save))

    def fetch_build(self):
        source = self.save / 'nova-source'
        source.mkdir()
        self.run(['git', 'init', '-q', str(source)])
        self.run(['git', '-C', str(source), 'remote', 'add', 'origin', 'https://github.com/nuotian4-spec/nova-image-studio.git'])
        os.environ['GIT_TERMINAL_PROMPT'] = '1'
        for key in ['GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_TRACE', 'GIT_TRACE_CURL', 'GIT_CURL_VERBOSE', 'GIT_CONFIG_PARAMETERS']:
            os.environ.pop(key, None)
        self.run(['git', '-c', 'credential.username=nuotian4-spec', '-c', 'core.askPass=', '-C', str(source), 'fetch', '--depth=2', 'origin', TARGET_BRANCH], interactive=True)
        require(self.out(['git', '-C', str(source), 'rev-parse', 'FETCH_HEAD']) == TARGET, 'Nova远端不再是固定候选')
        self.run(['git', '-C', str(source), 'cat-file', '-e', OLD_SHA + '^{commit}'])
        changed = self.out(['git', '-C', str(source), 'diff', '--name-only', OLD_SHA, TARGET]).splitlines()
        validate_product_diff(changed)
        for name, expected in [('server.js', NEW_SERVER), ('gemini-image-response.js', NEW_PARSER)]:
            require(digest(self.run(['git', '-C', str(source), 'show', TARGET + ':backend/' + name]).stdout) == expected, '未变后端哈希不符：' + name)
        self.run(['git', '-C', str(source), 'checkout', '--detach', TARGET])
        build = self.save / 'image-context'
        build.mkdir()
        for name in ('package.json', 'package-lock.json'):
            shutil.copyfile(source / name, build / name)
        shutil.copytree(source / 'frontend', build / 'frontend')
        # 上下文仅含固定提交前端与构建清单，绝不包含生产.env、数据卷或配置备份。
        for path in build.rglob('*'):
            require(not path.is_symlink(), '构建输入含链接')
            require(path.name not in ('.env', '.env.local', 'node_modules', '.next', 'out'), '构建输入含非源码产物或环境文件')
        (build / '.dockerignore').write_text('**/node_modules\n**/.next\n**/out\n**/.env*\n')
        base = 'sub2api-nova-studio:nova-release-base-' + self.old['Image'].split(':')[-1][:16]
        self.run(['docker', 'tag', self.old['Image'], base])
        require(self.inspect(base)['Id'] == self.old['Image'], '基底镜像身份变化')
        self.tag = 'sub2api-nova-studio:persistence-' + TARGET[:12] + '-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
        (build / 'Dockerfile').write_text(build_dockerfile(base))
        self.checkpoint('固定前端源码构建中，生产继续接受任务')
        self.build_with_progress(['docker', 'build', '--pull=false', '-t', self.tag, str(build)])
        self.image = self.inspect(self.tag)
        baseline = self.inspect(self.old['Image'])
        require(self.image['RootFS']['Layers'][:len(baseline['RootFS']['Layers'])] == baseline['RootFS']['Layers'], '候选不是旧镜像派生')
        for key in ['Env', 'Cmd', 'Entrypoint', 'WorkingDir', 'User', 'Volumes', 'ExposedPorts', 'Healthcheck', 'StopSignal']:
            require(self.image['Config'].get(key) == baseline['Config'].get(key), '镜像运行配置变化：' + key)
        # 离线容器只检查静态产物与原后端，无网络、无生产卷、无服务启动。
        result = self.out(['docker', 'run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=512m', '--pids-limit=64', '--entrypoint=node', self.tag, '-e', STATIC_CHECK])
        self.static_manifest = json.loads(result)
        require(self.static_manifest['revision'] == TARGET and self.static_manifest['files'] > 5, '前端静态产物核验失败')
        self.checkpoint('候选前端离线验证通过，生产尚未暂停', new_tag=self.tag, new_image=self.image['Id'], static_manifest=self.static_manifest)

    def build_with_progress(self, args):
        print('前端构建开始；最长30分钟，每30秒报告进度；详细日志保存在私有目录。', flush=True)
        started = time.monotonic()
        process = subprocess.Popen(args, stdout=self.log, stderr=self.log)
        while True:
            try:
                require(process.wait(timeout=30) == 0, '前端镜像构建失败，生产尚未暂停；查看private.log')
                return
            except subprocess.TimeoutExpired:
                elapsed = int(time.monotonic() - started)
                print(f'前端镜像仍在构建：{elapsed}秒；生产尚未暂停。', flush=True)
                if elapsed >= 1800:
                    process.terminate()
                    raise RuntimeError('前端构建等待超过30分钟，已终止CLI；需确认Docker构建是否已结束，禁止继续切换')

    def switch(self, before):
        require(identity(COMPOSE) == self.compose_id and identity(ENV) == self.env_id, '备份期间配置被修改')
        self.verify_others()
        # 复用已审查的原升级入口原子Compose修改器；同service双参只更新一个image。
        text = self.out(['git', '-C', '/opt/sub2api-custom', 'show', HOST_SOURCE_SHA + ':deploy/upgrade-custom.sh'])
        marker = 'cat > "$STATE_DIR/update-compose-images.py" <<\'PY\'\n'
        require(text.count(marker) == 1, 'Compose修改器边界不符')
        code = text.split(marker, 1)[1].split('\nPY\n', 1)[0]
        helper = self.save / 'update-compose-images.py'
        helper.write_text(code)
        # 先在副本验证输出语义，生产文件仍由helper核inode/hash后替换。
        copy = self.save / 'compose.candidate.yml'
        shutil.copy2(COMPOSE, copy)
        def update(file, ident, result):
            self.run(['python3', str(helper), str(file), SERVICE, self.tag, SERVICE, self.tag, *map(str, ident), str(result)])
        update(copy, identity(copy), self.save / 'compose.candidate.result')
        candidate_dc = DC[:-2] + ['-f', str(copy)]
        after = json.loads(self.out(candidate_dc + ['config', '--format', 'json']))
        compare_compose(before, after, self.tag)
        update(COMPOSE, self.compose_id, self.save / 'compose.production.result')
        self.new_compose_id = identity(COMPOSE)
        compare_compose(before, json.loads(self.out(DC + ['config', '--format', 'json'])), self.tag)
        self.checkpoint('Compose已更新，仅创建Nova停止态容器', new_compose_identity=self.new_compose_id)
        self.run(DC + ['up', '--no-start', '--no-deps', '--no-build', '--force-recreate', SERVICE])
        item = self.inspect(CONTAINER)
        require(not item['State']['Running'] and item['Image'] == self.image['Id'], '新容器状态或镜像不符')
        self.verify_mounts(item)
        runtime_equivalent(self.old, item)
        for key, backup in self.config_exists.items():
            source = backup + '/.' if Path(backup).is_dir() else backup
            self.run(['docker', 'cp', '-a', source, CONTAINER + ':' + self.paths[key]])
            restored = self.save / ('config-' + key + '.restored-check')
            self.run(['docker', 'cp', CONTAINER + ':' + self.paths[key], str(restored)])
            require(manifest(Path(backup)) == manifest(restored), '恢复内容核验失败：' + key)
        if self.state['env_existed']:
            self.run(['docker', 'cp', '-a', str(self.save / 'container.env.before'), CONTAINER + ':' + self.paths['env']])
        else:
            # 原.env不存在时仅热暂停创建了文件；若在data volume内，应删除该临时文件。
            if self.paths['env'].startswith(DATA + '/'):
                path = Path(VOLUME) / self.paths['env'][len(DATA) + 1:]
                require(path.is_file() and not path.is_symlink(), '临时.env状态异常')
                path.unlink()
        require(identity(COMPOSE) == self.new_compose_id and identity(ENV) == self.env_id, '恢复期间配置被修改')
        if self.state['env_existed']:
            verify = self.save / 'container.env.restored-check'
            self.run(['docker', 'cp', CONTAINER + ':' + self.paths['env'], str(verify)])
            require(verify.read_bytes() == self.original_env, '首次启动前原.env恢复校验失败')
        self.checkpoint('原配置已恢复，新Nova首次启动')
        self.run(DC + ['start', SERVICE])
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                q = self.queue()
                if q['acceptingNewTasks'] is True:
                    break
            except RuntimeError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError('新Nova90秒内未就绪')
        item = self.inspect(CONTAINER)
        require(item['Image'] == self.image['Id'] and item['Config']['Labels'].get('org.opencontainers.image.revision') == TARGET, '新Nova身份不符')
        self.verify_mounts(item)
        for file, expected in [('server.js', NEW_SERVER), ('gemini-image-response.js', NEW_PARSER)]:
            require(self.node("console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))", '/app/backend/' + file) == expected, '新容器代码哈希不符')
        require(json.loads(self.node(STATIC_CHECK)) == self.static_manifest, '运行前端产物与离线核验不符')
        self.node("fetch('http://127.0.0.1:3000/_nova/',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))")
        self.verify_others()
        require(identity(COMPOSE) == self.new_compose_id and identity(ENV) == self.env_id, '结束时配置发生并发改动')


def main():
    release = Release()
    try:
        release.execute()
    except (Exception, KeyboardInterrupt) as error:
        print('发布停止：' + str(error), file=sys.stderr)
        if release.save:
            print('阶段：' + release.phase + '；恢复资料：' + str(release.save), file=sys.stderr)
            print('不清锁、不强杀、不自动回灌数据。若旧容器仍在运行且仅暂停，核对状态后用container.env.before恢复原.env（原不存在时删除本次新增文件）；若已替换，按state.json旧镜像和配置备份恢复。必须核健康后再开放。', file=sys.stderr)
        return 1
    finally:
        if release.shared_fd is not None:
            os.close(release.shared_fd)
    return 0


if __name__ == '__main__':
    sys.exit(main())
