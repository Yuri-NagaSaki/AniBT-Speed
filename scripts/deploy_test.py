import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock
from deploy import Deployment, atomic_link


class DeploymentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.root, self.state, self.unit = base/'opt', base/'state', base/'unit'
        self.state.mkdir()
        self.old = self.root/'releases'/('a'*40)
        self.old.mkdir(parents=True)
        (self.old/'anibt').write_bytes(b'old binary')
        (self.old/'worker.env').write_text('old config')
        (self.old/'manifest.json').write_text(json.dumps({'schema': 2, 'revision': 'a'*40}))
        (self.old/'activate').write_text('a'*40)
        atomic_link(self.old, self.root/'current')
        self.unit.write_text('old unit')
        (self.state/'state.sqlite3').write_bytes(b'old durable state')
        self.artifact = base/'artifact'
        self.artifact.mkdir()
        (self.artifact/'anibt').write_bytes(b'new binary')
        (self.artifact/'anibt.service').write_text('ExecStart=@ROOT@/current/anibt\nReadOnlyPaths=@MEDIA@')
        (self.artifact/'manifest.json').write_text(json.dumps({'schema': 2, 'revision': 'b'*40}))
        (self.artifact/'SHA256SUMS').write_text(''.join(hashlib.sha256((self.artifact/n).read_bytes()).hexdigest()+'  '+n+'\n' for n in ['anibt', 'anibt.service', 'manifest.json']))
        self.config = base/'config'
        self.config.write_text('ANIBT_STATE_DIR='+str(self.state))
        self.calls = []

        def run(*args, check=True):
            self.calls.append(args)
            if 'backup' in args:
                Path(args[-1]).write_bytes((self.state/'state.sqlite3').read_bytes())
            return subprocess.CompletedProcess(args, 3 if 'is-active' in args else 0, '', '')
        self.deploy = Deployment(self.root, self.state, self.unit, run)
        self.deploy.ownership = Mock()

    def test_pre_activation_failure_restores_entire_release(self):
        def wait(candidate, revision, phase, timeout=120):
            (self.state/'state.sqlite3').write_bytes(b'new startup changes')
            raise RuntimeError('candidate cannot become ready')
        self.deploy.wait_status = wait
        with self.assertRaises(RuntimeError):
            self.deploy.apply(self.artifact, self.config)
        self.assertEqual((self.state/'state.sqlite3').read_bytes(), b'old durable state')
        self.assertEqual((self.root/'current').resolve(), self.old)
        self.assertEqual((self.old/'worker.env').read_text(), 'old config')
        self.assertEqual(self.unit.read_text(), 'old unit')

    def test_after_activation_rollback_preserves_side_effect_receipts(self):
        def wait(candidate, revision, phase, timeout=120):
            if phase == 'ready':
                return {'status': 'ready'}
            (self.state/('effects-'+revision)).write_text('activated')
            (self.state/'state.sqlite3').write_bytes(b'new external effect receipt')
            raise RuntimeError('health failed after activation')
        self.deploy.wait_status = wait
        with self.assertRaises(RuntimeError):
            self.deploy.apply(self.artifact, self.config)
        self.assertEqual((self.state/'state.sqlite3').read_bytes(), b'new external effect receipt')
        self.assertEqual((self.root/'current').resolve(), self.old)
        self.assertEqual(self.unit.read_text(), 'old unit')

    def test_late_activation_is_detected_after_service_stops(self):
        candidate, manifest = self.deploy.stage(self.artifact, self.config)
        backup = self.deploy.checkpoint(self.old, candidate, manifest['revision'])
        original = self.deploy.run
        def run(*args, check=True):
            if args == ('systemctl', 'stop', 'anibt.service'):
                (self.state/('effects-'+manifest['revision'])).write_text('late activation')
                (self.state/'state.sqlite3').write_bytes(b'late external receipt')
            return original(*args, check=check)
        self.deploy.run = run
        self.deploy.restore(backup)
        self.assertEqual((self.state/'state.sqlite3').read_bytes(), b'late external receipt')

    def test_bad_config_never_stops_existing_service(self):
        self.deploy.binary = Mock(side_effect=RuntimeError('invalid new config'))
        with self.assertRaises(RuntimeError):
            self.deploy.apply(self.artifact, self.config)
        self.assertEqual(self.calls, [])
        self.assertEqual((self.root/'current').resolve(), self.old)
        self.assertEqual((self.state/'state.sqlite3').read_bytes(), b'old durable state')

    def test_checksum_rejected_before_switch(self):
        (self.artifact/'anibt').write_bytes(b'corrupt')
        with self.assertRaises(ValueError):
            self.deploy.apply(self.artifact, self.config)
        self.assertEqual(self.calls, [])
        self.assertEqual((self.root/'current').resolve(), self.old)


if __name__ == '__main__':
    unittest.main()
