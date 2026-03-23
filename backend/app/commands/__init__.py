from app.commands.access import handle_access
from app.commands.alert import handle_alert
from app.commands.analyze import handle_analyze
from app.commands.apitest import handle_apitest
from app.commands.clipboard import handle_clipboard
from app.commands.code import handle_code
from app.commands.collab import handle_collab
from app.commands.dbmanage import handle_dbmanage
from app.commands.docs import handle_docs
from app.commands.email_cmd import handle_email
from app.commands.filemanage import handle_filemanage
from app.commands.gallery import handle_gallery
from app.commands.github_cmd import handle_github
from app.commands.mobile import handle_mobile
from app.commands.plugin import handle_plugin
from app.commands.preview import handle_preview
from app.commands.report import handle_report
from app.commands.review import handle_review
from app.commands.scan import handle_scan
from app.commands.schedule import handle_schedule
from app.commands.search import handle_search
from app.commands.shell_cmd import handle_shell
from app.commands.templates import handle_templates
from app.commands.testgen import handle_testgen
from app.commands.voice import handle_voice

__all__ = [
    "handle_code",
    "handle_search",
    "handle_access",
    "handle_scan",
    "handle_alert",
    "handle_report",
    "handle_analyze",
    "handle_review",
    "handle_shell",
    "handle_filemanage",
    "handle_schedule",
    "handle_apitest",
    "handle_docs",
    "handle_github",
    "handle_templates",
    "handle_dbmanage",
    "handle_plugin",
    "handle_gallery",
    "handle_voice",
    "handle_clipboard",
    "handle_email",
    "handle_collab",
    "handle_mobile",
    "handle_preview",
    "handle_testgen",
]
