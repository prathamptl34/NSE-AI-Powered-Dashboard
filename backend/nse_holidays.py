from datetime import datetime, date

# NSE Equity Market Holidays 2025
# Source: https://www.nseindia.com/products-services/equity-market-timings-holidays
NSE_HOLIDAYS_2025 = {
    "2025-01-26",  # Republic Day
    "2025-02-19",  # Chhatrapati Shivaji Maharaj Jayanti
    "2025-03-14",  # Holi
    "2025-04-10",  # Shri Ram Navami
    "2025-04-14",  # Dr. Baba Saheb Ambedkar Jayanti
    "2025-04-18",  # Good Friday
    "2025-05-01",  # Maharashtra Day
    "2025-08-15",  # Independence Day
    "2025-08-27",  # Ganesh Chaturthi
    "2025-10-02",  # Mahatma Gandhi Jayanti
    "2025-10-02",  # Dussehra (check NSE for exact date)
    "2025-10-21",  # Diwali Laxmi Puja (Muhurat Trading — partial day, treat as closed)
    "2025-10-22",  # Diwali Balipratipada
    "2025-11-05",  # Prakash Gurpurb Sri Guru Nanak Dev Ji
    "2025-12-25",  # Christmas
}

# Add prior years as needed for historical lookups
NSE_HOLIDAYS_2024 = {
    "2024-01-26",  # Republic Day
    "2024-03-25",  # Holi
    "2024-03-29",  # Good Friday
    "2024-04-14",  # Dr. Baba Saheb Ambedkar Jayanti
    "2024-04-17",  # Ram Navami
    "2024-04-21",  # Mahavir Jayanti
    "2024-05-01",  # Maharashtra Day
    "2024-05-23",  # Buddha Pournima
    "2024-06-17",  # Bakri Id
    "2024-07-17",  # Muharram
    "2024-08-15",  # Independence Day
    "2024-10-02",  # Mahatma Gandhi Jayanti
    "2024-11-01",  # Diwali Laxmi Puja
    "2024-11-15",  # Gurunanak Jayanti
    "2024-12-25",  # Christmas
}

ALL_HOLIDAYS = NSE_HOLIDAYS_2025 | NSE_HOLIDAYS_2024


def is_trading_day(date_str: str) -> tuple[bool, str]:
    """
    Check if the given date (YYYY-MM-DD) is a valid NSE trading day.
    Returns (is_valid: bool, reason: str)
    """
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return False, "Invalid date format. Use YYYY-MM-DD."

    today = date.today()

    if d > today:
        return False, f"Cannot fetch future dates. Today is {today.strftime('%d %b %Y')}."

    if d.weekday() == 5:
        return False, f"{date_str} is a Saturday. NSE is closed on weekends."

    if d.weekday() == 6:
        return False, f"{date_str} is a Sunday. NSE is closed on weekends."

    if date_str in ALL_HOLIDAYS:
        return False, f"{date_str} is an NSE market holiday."

    # Angel One historical data goes back ~2 years
    two_years_ago = date(today.year - 2, today.month, today.day)
    if d < two_years_ago:
        return False, f"Data not available before {two_years_ago.strftime('%d %b %Y')}. Angel One provides ~2 years of history."

    return True, "Valid trading day."

from datetime import timedelta

def get_last_trading_day_str() -> str:
    """
    Returns the YYYY-MM-DD string of the most recent valid trading day,
    including today if today is a trading day.
    """
    d = datetime.now()
    for _ in range(10):  # Check up to 10 days back
        date_str = d.strftime("%Y-%m-%d")
        if is_trading_day(date_str)[0]:
            return date_str
        d -= timedelta(days=1)
    
    return datetime.now().strftime("%Y-%m-%d") # Fallback to today
