"""发布助手离线定向验证；不执行Docker、网络、生产写入或产品测试。"""
import ast
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).parent
SOURCE = HERE / 'release-nova-persistence-20261022.py'
spec = importlib.util.spec_from_file_location('nova_release', SOURCE)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class 发布定向验证(unittest.TestCase):
    def test_构建配方只替换完整前端(self):
        recipe = release.build_dockerfile('fixed-base')
        self.assertEqual(recipe.count('FROM fixed-base'), 2)
        self.assertIn('npm ci --include=dev && npm run build', recipe)
        final = recipe.rsplit('FROM fixed-base', 1)[1]
        self.assertIn('RUN rm -rf /app/frontend/out', final)
        self.assertIn('COPY --from=frontend-builder /nova-build/frontend/out/ /app/frontend/out/', final)
        self.assertNotIn('backend/', final)
        self.assertIn(release.TARGET, recipe)

    def test_后端锁与配置变化均拒绝(self):
        release.validate_product_diff(['frontend/src/lib/job-store.ts'])
        for paths in ([], ['backend/server.js'], ['frontend/package-lock.json'], ['frontend/next.config.ts'], ['frontend/src/../package.json']):
            with self.assertRaises(RuntimeError):
                release.validate_product_diff(paths)

    def test_固定候选真实输入符合守卫(self):
        root = HERE.parent
        paths = subprocess.check_output(['git', 'diff', '--name-only', release.OLD_SHA, release.TARGET], cwd=root, text=True).splitlines()
        release.validate_product_diff(paths)
        self.assertEqual(len(paths), 14)
        for name, expected in [('server.js', release.NEW_SERVER), ('gemini-image-response.js', release.NEW_PARSER)]:
            data = subprocess.check_output(['git', 'show', release.TARGET + ':backend/' + name], cwd=root)
            self.assertEqual(release.digest(data), expected)

    def test_父站源码与运行身份分离及锁句柄不继承(self):
        text = SOURCE.read_text(encoding='utf-8')
        self.assertNotEqual(release.HOST_SHA, release.HOST_SOURCE_SHA)
        self.assertIn("HOST_SOURCE_SHA + ':deploy/upgrade-custom.sh'", text)
        self.assertIn('os.O_CLOEXEC', text)
        self.assertIn('os.set_inheritable(self.shared_fd, False)', text)
        self.assertIn('(st.st_dev, st.st_ino) == self.lock_identity', text)
        tree = ast.parse(text)
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Release')
        execute = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == 'execute')
        calls = [n for n in ast.walk(execute) if isinstance(n, ast.Call)]
        build = next(n for n in calls if isinstance(n.func, ast.Attribute) and n.func.attr == 'fetch_build')
        pause = next(n for n in calls if isinstance(n.func, ast.Attribute) and n.func.attr == 'node' and n.args and isinstance(n.args[0], ast.Name) and n.args[0].id == 'pause_script')
        self.assertLess(build.lineno, pause.lineno)

    def test_构建失败不执行后续镜像验证(self):
        class Fake(release.Release):
            def __init__(self, directory):
                super().__init__()
                self.save = Path(directory)
                self.old = {'Image': release.OLD_IMAGE}
                self.commands = []
            def run(self, args, **kwargs):
                self.commands.append(args)
                if 'checkout' in args:
                    source = self.save / 'nova-source'
                    (source / 'frontend').mkdir()
                    (source / 'frontend' / 'package.json').write_text('{}')
                    for name in ('package.json', 'package-lock.json'):
                        (source / name).write_text('{}')
                if 'show' in args:
                    return subprocess.CompletedProcess(args, 0, subprocess.check_output(['git', 'show', args[-1]], cwd=HERE.parent), b'')
                return subprocess.CompletedProcess(args, 0, b'', b'')
            def out(self, args, **kwargs):
                if 'rev-parse' in args:
                    return release.TARGET
                if 'diff' in args:
                    return 'frontend/src/lib/job-store.ts'
                raise AssertionError(args)
            def inspect(self, name):
                return {'Id': release.OLD_IMAGE}
            def checkpoint(self, phase, **kwargs):
                self.phase = phase
            def build_with_progress(self, args):
                raise RuntimeError('模拟构建失败')
        with tempfile.TemporaryDirectory() as directory:
            fake = Fake(directory)
            with self.assertRaisesRegex(RuntimeError, '模拟构建失败'):
                fake.fetch_build()
            self.assertIn('生产继续接受任务', fake.phase)
            self.assertFalse(any('exec' in command or 'stop' in command or 'compose' in command for command in fake.commands))

    def test_Compose禁止非Nova语义变化(self):
        before = {'services': {'nova-studio': {'image': 'old'}, 'sub2api': {'image': 'host'}}}
        after = json.loads(json.dumps(before))
        after['services']['nova-studio']['image'] = 'new'
        release.compare_compose(before, after, 'new')
        after['services']['sub2api']['image'] = 'bad'
        with self.assertRaises(RuntimeError):
            release.compare_compose(before, after, 'new')


if __name__ == '__main__':
    unittest.main(verbosity=2)
