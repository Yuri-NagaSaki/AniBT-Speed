#!/usr/bin/env python3
"""Explicit, one-time config conversion; never sourced or used by the worker."""
import argparse
import os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('destination', type=Path)
args = parser.parse_args()
values = {}
for line in args.source.read_text().splitlines():
    if line.strip() and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
mapping = {
    'QBT_API_KEY': 'QBT_API_KEY', 'CATEGORY': 'CATEGORY', 'ANIBT_API_URL': 'API_URL',
    'ANIBT_API_TOKEN': 'API_TOKEN', 'ANIBT_EXCLUDED_GROUP_SLUGS': 'EXCLUDED_GROUPS',
    'EXCLUDED_TAGS': 'PROTECTED_TAGS', 'POOL_TARGET': 'POOL_TARGET', 'POOL_BATCH': 'POOL_BATCH',
    'ROTATION_BATCH': 'ROTATION_BATCH', 'RETAIN_DAYS': 'RETAIN_DAYS', 'CLEANUP_BATCH': 'CLEANUP_BATCH',
    'MIN_FREE_GIB': 'MIN_FREE_GIB', 'DISK_MAX_USED_PERCENT': 'MAX_DISK_PERCENT',
    'CONTROL_MAX_COMMANDS': 'CONTROL_COMMANDS', 'RSS_CONCURRENCY': 'FEED_CONCURRENCY',
    'RSS_FEED_LIMIT': 'FEED_LIMIT', 'BOOTSTRAP_HISTORY': 'BOOTSTRAP_HISTORY', 'RSS_ENABLED': 'FEEDS_ENABLED',
    'DOWNLOAD_BATCH': 'ADD_BATCH', 'PREPARE_BATCH': 'PREPARE_BATCH', 'MAX_TORRENT_GIB': 'MAX_TORRENT_GIB',
    'POOL_ENABLED': 'POOL_ENABLED', 'CLEANUP_ENABLED': 'CLEANUP_ENABLED', 'RATE_ENABLED': 'RATE_ENABLED',
    'UPLOAD_MIB': 'UPLOAD_MIB', 'DOWNLOADING_UPLOAD_MIB': 'DOWNLOADING_UPLOAD_MIB',
    'DOWNLOAD_MIB': 'DOWNLOAD_MIB', 'HOURLY_UPLOAD_GIB': 'HOURLY_UPLOAD_GIB', 'DAILY_UPLOAD_GIB': 'DAILY_UPLOAD_GIB',
    'HISTORY_DAYS': 'HISTORY_DAYS', 'MEDIAINFO_ENABLED': 'MEDIA_ENABLED', 'MEDIAINFO_SAMPLE_FILES': 'MEDIA_SAMPLES',
    'MEDIAINFO_MEMORY_MB': 'MEDIA_MEMORY_MIB', 'MEDIAINFO_IO_PRESSURE_LIMIT': 'MEDIA_IO_PRESSURE',
    'NOTIFICATIONS_ENABLED': 'TELEGRAM_ENABLED', 'NOTIFY_TOKEN': 'TELEGRAM_TOKEN', 'NOTIFY_CHAT_ID': 'TELEGRAM_CHAT_ID',
    'DAILY_SUMMARY_HOUR': 'SUMMARY_HOUR', 'TIMEZONE': 'TIMEZONE',
}
timings = {
    'CONTROL_INTERVAL_SECONDS': ('CONTROL_INTERVAL','s'), 'CONTROL_BUDGET_SECONDS': ('CONTROL_BUDGET','s'),
    'QBT_TIMEOUT_SECONDS': ('QBT_TIMEOUT','s'), 'RSS_POLL_SECONDS': ('FEED_INTERVAL','s'),
    'RSS_SYNC_SECONDS': ('FEED_SYNC_INTERVAL','s'), 'RSS_MAX_AGE_HOURS': ('RELEASE_MAX_AGE','h'),
    'CONFIRMATION_SECONDS': ('CONFIRM_TIMEOUT','s'), 'ROTATION_INTERVAL_SECONDS': ('ROTATION_INTERVAL','s'),
    'EXPOSURE_SECONDS': ('EXPOSURE','s'), 'HOT_HOURS': ('HOT_WINDOW','h'),
    'CLEANUP_INTERVAL_SECONDS': ('CLEANUP_INTERVAL','s'), 'PROTECT_HOURS': ('CLEANUP_PROTECT','h'),
    'MEDIAINFO_TIMEOUT_SECONDS': ('MEDIA_TIMEOUT','s'),
}
out = {'QBT_URL': 'http://127.0.0.1:8181', 'QBT_DOWNLOAD_ROOT': values.get('DOWNLOAD_ROOT','/media/AniBT'),
       'MEDIA_ROOT': '/hdd/media/AniBT', 'STATE_DIR': '/var/lib/anibt'}
for old, new in mapping.items():
    if old in values:
        out[new] = values[old]
for old, (new, suffix) in timings.items():
    if old in values:
        out[new] = values[old] + suffix
fd = os.open(args.destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write(''.join('ANIBT_'+key+'='+value+'\n' for key,value in out.items()))
print('Converted configuration; secrets were not printed.')
