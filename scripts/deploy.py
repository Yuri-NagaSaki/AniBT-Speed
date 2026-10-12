#!/usr/bin/env python3
"""Versioned native deployment. No qB/Telegram mutation before activation.

Before activation rollback restores binary, config, unit AND state snapshot.
After activation a same-schema rollback preserves live durable state so already
issued external effects are reconciled instead of repeated from an old database.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import time


def run(*args, check=True):
    return subprocess.run(args, text=True, capture_output=True, check=check)


def atomic_link(target, link):
    tmp = link.with_name(link.name + '.new')
    tmp.unlink(missing_ok=True)
    tmp.symlink_to(target)
    tmp.replace(link)


def settings(file):
    out = {}
    for line in file.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, value = line.split('=', 1)
        out[key.strip()] = value.strip()
    return out


class Deployment:
    def __init__(self, root=Path('/opt/anibt'), state=Path('/var/lib/anibt'),
                 unit=Path('/etc/systemd/system/anibt.service'), runner=run):
        self.root, self.state, self.unit, self.run = root, state, unit, runner
        self.current = root / 'current'

    def binary(self, release, *args, check=True):
        return self.run(str(release/'anibt'), '--config', str(release/'worker.env'),
                        *args, check=check)

    def stage(self, artifact, config):
        expected = {'anibt', 'anibt.service', 'manifest.json'}
        lines = (artifact/'SHA256SUMS').read_text().splitlines()
        hashes = {}
        for line in lines:
            digest, name = line.split('  ', 1)
            if name not in expected or name in hashes:
                raise ValueError('invalid artifact file list')
            hashes[name] = digest
        if set(hashes) != expected:
            raise ValueError('incomplete artifact')
        for name, digest in hashes.items():
            if hashlib.sha256((artifact/name).read_bytes()).hexdigest() != digest:
                raise ValueError('artifact checksum mismatch: '+name)
        manifest = json.loads((artifact/'manifest.json').read_text())
        revision = manifest['revision']
        if not re.fullmatch('[0-9a-f]{40}', revision) or manifest['schema'] != 2:
            raise ValueError('unsupported build manifest')
        destination = self.root/'releases'/revision
        if destination.exists():
            raise ValueError('release already exists; build a new revision')
        destination.mkdir(parents=True, mode=0o755)
        for name in expected | {'SHA256SUMS'}:
            shutil.copy2(artifact/name, destination/name)
        os.chmod(destination/'anibt', 0o755)
        shutil.copyfile(config, destination/'worker.env')
        os.chmod(destination/'worker.env', 0o600)
        cfg = settings(destination/'worker.env')
        if Path(cfg.get('ANIBT_STATE_DIR', '/var/lib/anibt')) != self.state:
            raise ValueError('deployment state directory differs from configuration')
        media = cfg.get('ANIBT_MEDIA_ROOT', '/hdd/media/AniBT')
        # Systemd paths are rendered as quoted directives, with literal % escaped.
        if '\n' in media or not media.startswith('/') or '"' in media or '\\' in media:
            raise ValueError('invalid media root for service unit')
        unit = (destination/'anibt.service').read_text().replace('@ROOT@', str(self.root))
        unit = unit.replace('@MEDIA@', '"'+media.replace('%', '%%')+'"')
        (destination/'installed.service').write_text(unit)
        result = self.binary(destination, 'check')
        if result.stdout and json.loads(result.stdout).get('revision') != revision:
            raise ValueError('binary and manifest revisions differ')
        return destination, manifest

    def checkpoint(self, previous, candidate, revision):
        backup = self.root/'backups'/(time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())+'-'+revision[:10])
        backup.mkdir(parents=True, mode=0o700)
        meta = {'previous': str(previous) if previous else None, 'candidate': str(candidate),
                'revision': revision, 'had_unit': self.unit.exists(), 'schema': 2}
        if self.unit.exists():
            shutil.copy2(self.unit, backup/'anibt.service')
        if previous:
            shutil.copy2(previous/'worker.env', backup/'worker.env')
        if (self.state/'state.sqlite3').exists():
            self.binary(previous or candidate, 'backup', str(backup/'state.sqlite3'))
            os.chmod(backup/'state.sqlite3', 0o600)
        (backup/'deployment.json').write_text(json.dumps(meta, indent=2))
        return backup

    def stop_service(self):
        self.run('systemctl', 'stop', 'anibt.service', check=False)
        active = self.run('systemctl', 'is-active', '--quiet', 'anibt.service', check=False)
        if active.returncode == 0:
            raise RuntimeError('service did not stop; state replacement refused')

    def restore(self, backup):
        meta = json.loads((backup/'deployment.json').read_text())
        previous = Path(meta['previous']) if meta['previous'] else None
        self.stop_service()
        # Activation can race the health timeout. Inspect only after stop drains it.
        effects = (self.state/('effects-'+meta['revision'])).exists()
        if effects:
            if not previous:
                raise RuntimeError('activation occurred; keep native state and repair forward; automatic Docker rollback is forbidden')
            old = json.loads((previous/'manifest.json').read_text())
            if old['schema'] != meta['schema']:
                raise RuntimeError('live state schema is incompatible with rollback binary')
        else:
            for suffix in ['', '-wal', '-shm']:
                (self.state/('state.sqlite3'+suffix)).unlink(missing_ok=True)
            if (backup/'state.sqlite3').exists():
                shutil.copy2(backup/'state.sqlite3', self.state/'state.sqlite3')
        if previous:
            shutil.copy2(backup/'worker.env', previous/'worker.env')
            atomic_link(previous, self.current)
        else:
            self.current.unlink(missing_ok=True)
        if meta['had_unit']:
            shutil.copy2(backup/'anibt.service', self.unit)
        else:
            self.unit.unlink(missing_ok=True)
        self.run('systemctl', 'daemon-reload')
        if previous:
            self.ownership()
            self.run('systemctl', 'start', 'anibt.service')
        return 'preserved live state' if effects else 'restored state snapshot'

    def ownership(self):
        uid = pwd.getpwnam('anibt').pw_uid
        gid = pwd.getpwnam('anibt').pw_gid
        os.chown(self.state, uid, gid)
        for file in self.state.iterdir():
            if file.is_file():
                os.chown(file, uid, gid)

    def wait_status(self, candidate, revision, phase, timeout=120):
        deadline = time.monotonic()+timeout
        while time.monotonic() < deadline:
            result = self.binary(candidate, 'status', check=False)
            try:
                status = json.loads(result.stdout)
            except ValueError:
                status = {}
            if result.returncode == 0 and status.get('revision') == revision and status.get('status') == phase:
                if phase == 'ready' or status.get('jobs', {}).get('control', {}).get('last_success', 0) >= status.get('started_at', 0):
                    return status
            time.sleep(1)
        raise RuntimeError('candidate did not reach '+phase)

    def apply(self, artifact, config):
        candidate, manifest = self.stage(artifact, config)
        revision = manifest['revision']
        previous = self.current.resolve() if self.current.is_symlink() else None
        self.stop_service()
        try:
            backup = self.checkpoint(previous, candidate, revision)
        except BaseException:
            if previous:
                self.run('systemctl', 'start', 'anibt.service')
            raise
        try:
            self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.ownership()
            shutil.copy2(candidate/'installed.service', self.unit)
            atomic_link(candidate, self.current)
            self.run('systemctl', 'daemon-reload')
            self.run('systemctl', 'enable', 'anibt.service')
            self.run('systemctl', 'start', 'anibt.service')
            self.wait_status(candidate, revision, 'ready')
            (candidate/'activate').write_text(revision+'\n')
            status = self.wait_status(candidate, revision, 'ok')
            print(json.dumps({'deployed': revision, 'backup': str(backup), 'status': status['status']}))
        except BaseException:
            outcome = self.restore(backup)
            print('Deployment rolled back: '+outcome, flush=True)
            raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['apply', 'rollback'])
    parser.add_argument('path', type=Path)
    parser.add_argument('--config', type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('deployment requires root')
    deploy = Deployment()
    deploy.root.mkdir(parents=True, exist_ok=True)
    lock = (deploy.root/'deploy.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if args.command == 'rollback':
        print(deploy.restore(args.path))
        return
    if not args.config:
        parser.error('apply requires --config')
    try:
        pwd.getpwnam('anibt')
    except KeyError:
        run('useradd', '--system', '--home-dir', '/var/lib/anibt', '--shell', '/usr/sbin/nologin', 'anibt')
    deploy.apply(args.path, args.config)


if __name__ == '__main__':
    main()
