from apscheduler.schedulers.background import BackgroundScheduler

scheduler = BackgroundScheduler()


def start_scheduler():
    from app.services.space_manager import check_space
    from app.services.queue_manager import check_queue
    from app.services.rate_limiter import check_rate
    from app.services.tag_manager import check_tags
    from app.services.rss_poller import poll_rss_feeds
    from app.services.telegram_notifier import send_daily_summary
    from app.services.mediainfo_processor import check_mediainfo

    scheduler.add_job(check_space, "interval", minutes=5, id="space_check")
    scheduler.add_job(check_queue, "interval", minutes=3, id="queue_check")
    scheduler.add_job(check_rate, "interval", minutes=1, id="rate_check")
    scheduler.add_job(check_tags, "interval", minutes=2, id="tag_check")
    scheduler.add_job(poll_rss_feeds, "interval", minutes=5, id="rss_poll")
    scheduler.add_job(send_daily_summary, "cron", hour=20, minute=0, id="daily_summary")
    scheduler.add_job(check_mediainfo, "interval", minutes=5, id="mediainfo_check", replace_existing=True)

    scheduler.start()
