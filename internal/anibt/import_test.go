package anibt

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

func TestImportV1ReceiptsPendingAndOneTimeGuard(t *testing.T) {
	c := testConfig(t)
	source := filepath.Join(t.TempDir(), "v1.sqlite3")
	db, e := sql.Open("sqlite", source)
	must(t, e)
	_, e = db.Exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); INSERT INTO meta VALUES('schema','1');
 CREATE TABLE feeds(slug TEXT,name TEXT,enabled INT,initialized INT,last_poll REAL,error TEXT); INSERT INTO feeds VALUES('g','Group',1,1,100,'');
 CREATE TABLE seen_keys(key TEXT,outcome TEXT); INSERT INTO seen_keys VALUES('known','confirmed'),('poison','group identity mismatch');
 CREATE TABLE media(hash TEXT,name TEXT,save_path TEXT,status TEXT,files TEXT,payload TEXT,attempts INT,next_attempt REAL,error TEXT,updated_at REAL); INSERT INTO media VALUES('done','name','/media/AniBT','done',NULL,NULL,0,0,'',100),('pending','name','/media/AniBT','upload',NULL,'{"infoHash":"pending"}',3,1000,'HTTP 404',100);
 CREATE TABLE exposures(hash TEXT,started_at REAL,last_started_at REAL,seen_at REAL);INSERT INTO exposures VALUES('h',1,1,1);
 CREATE TABLE traffic(ts REAL,uploaded INT,downloaded INT,seconds REAL); INSERT INTO traffic VALUES(1000,1000,0,600);
 CREATE TABLE releases(key TEXT,slug TEXT,title TEXT,url TEXT,metadata TEXT,published REAL,status TEXT,infohash TEXT,content BLOB,save_path TEXT,tags TEXT,created_at REAL,updated_at REAL,attempts INT,next_attempt REAL,submitted_at REAL,error TEXT);
 INSERT INTO releases VALUES('known','g','name','magnet:old','{"group_name":"Group"}',100,'confirmed','hash',NULL,'/media/AniBT','AniBT',1,100,1,0,10,'');`)
	must(t, e)
	must(t, db.Close())
	before, e := os.ReadFile(source)
	must(t, e)
	must(t, ImportV1(t.Context(), c, source))
	s, e := OpenStore(filepath.Join(c.StateDir, "state.sqlite3"), false, 12)
	must(t, e)
	defer s.Close()
	if count(t, s, "SELECT count(*) FROM receipts WHERE kind='media'") != 1 || count(t, s, "SELECT count(*) FROM receipts WHERE key='poison'") != 0 || count(t, s, "SELECT count(*) FROM tasks WHERE lane='media' AND phase='upload' AND attempts=3") != 1 || count(t, s, "SELECT count(*) FROM tasks WHERE phase='tracking'") != 1 {
		t.Fatal("migration lost identity or pending work")
	}
	if count(t, s, "SELECT count(*) FROM receipts WHERE kind='content' AND key='done'") != 1 {
		t.Fatal("historical completed media lost content identity")
	}
	if count(t, s, "SELECT count(*) FROM traffic WHERE known=0 AND uploaded=0") != 1 {
		t.Fatal("legacy unknown traffic imported as current")
	}
	after, e := os.ReadFile(source)
	must(t, e)
	if string(before) != string(after) {
		t.Fatal("source modified")
	}
	if ImportV1(context.Background(), c, source) == nil {
		t.Fatal("reimport not rejected")
	}
}
