with open('frontend/index.html', 'r') as f:
    content = f.read()

content = content.replace("</header>\n    </header>", "</header>")

with open('frontend/index.html', 'w') as f:
    f.write(content)
