from apscheduler.schedulers.background import BackgroundScheduler

scheduler = BackgroundScheduler()


def start_scheduler():
    from app.services.space_manager import check_space
    from app.services.queue_manager import check_queue
    from app.services.rate_limiter import check_rate

    scheduler.add_job(check_space, "interval", minutes=5, id="space_check")
    scheduler.add_job(check_queue, "interval", minutes=3, id="queue_check")
    scheduler.add_job(check_rate, "interval", minutes=1, id="rate_check")

    scheduler.start()
