"""Create new isolated slitting test schemas; source databases are read-only."""
from pathlib import Path
import re
import mysql.connector
from dotenv import dotenv_values

def main():
 root=Path(__file__).resolve().parents[1]
 source=dotenv_values(root/'.env')
 def ident(value):
  if not re.fullmatch(r'[A-Za-z0-9_]+',value): raise ValueError('Unsafe schema/table name')
  return '`'+value+'`'
 connection=mysql.connector.connect(host=source.get('DB_HOST','127.0.0.1'),port=int(source.get('DB_PORT','3306')),user=source['DB_USER'].strip(),password=source.get('DB_PASSWORD',''))
 cursor=connection.cursor()
 pairs=[(source['DB_NAME'].strip(),'slitting_multi_test'),(source.get('IMPORT_SCHEMA','slitting_system_import'),'slitting_multi_test_import')]
 for original,target in pairs:
  cursor.execute('SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name=%s',(target,))
  if cursor.fetchone()[0]: raise RuntimeError('Test schema already exists: '+target)
 for original,target in pairs:
  cursor.execute('CREATE DATABASE '+ident(target)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
  cursor.execute('SELECT table_name FROM information_schema.tables WHERE table_schema=%s AND table_type=\'BASE TABLE\'',(original,))
  tables=[r[0] for r in cursor.fetchall()]
  for table in tables:
   cursor.execute('CREATE TABLE '+ident(target)+'.'+ident(table)+' LIKE '+ident(original)+'.'+ident(table))
   cursor.execute('INSERT INTO '+ident(target)+'.'+ident(table)+' SELECT * FROM '+ident(original)+'.'+ident(table))
  print('Cloned',len(tables),'tables into',target)
 connection.commit();connection.close()
 # Reuse local test credentials without displaying or putting them into tracked files.
 def quote(value): return "'"+str(value).replace('\\','\\\\').replace("'","\\'")+"'"
 settings={'SLITTING_DB_NAME':'slitting_multi_test','SLITTING_IMPORT_SCHEMA':'slitting_multi_test_import','SLITTING_DB_USER':source['DB_USER'].strip(),'SLITTING_DB_PASSWORD':source.get('DB_PASSWORD','')}
 (root/'.env.departments').write_text('\n'.join(k+'='+quote(v) for k,v in settings.items())+'\n',encoding='utf-8')
 print('Private .env.departments written; existing .env preserved.')

if __name__ == "__main__":
 main()
