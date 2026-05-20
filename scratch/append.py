import os

src_file = "scratch/screener.css"
dest_file = "src/index.css"

with open(src_file, 'r', encoding='utf-8') as sf:
    content = sf.read()

with open(dest_file, 'a', encoding='utf-8') as df:
    df.write('\n\n' + content + '\n')

print("CSS appended successfully.")
