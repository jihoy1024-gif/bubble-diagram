"""Write artifact.html: index.html without the document skeleton (claude.ai adds its own)."""
import os, re
here = os.path.dirname(os.path.abspath(__file__))
s = open(os.path.join(here, 'index.html'), encoding='utf8').read()
head = re.search(r'<head>(.*?)</head>', s, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', s, re.S).group(1)
head = re.sub(r'\s*<meta charset[^>]*>|\s*<meta name="viewport"[^>]*>', '', head)
open(os.path.join(here, 'artifact.html'), 'w', encoding='utf8').write(head.strip() + '\n' + body.strip() + '\n')
print('artifact.html written')
