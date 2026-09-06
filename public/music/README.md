# 音源の置き方

1. このフォルダ（`public/music/`）に音声ファイルを置く（mp3 / wav / ogg / m4a / flac / aac）
2. `playlist.json` の `tracks` に追記する

```json
{
  "tracks": [
    { "title": "曲名", "artist": "アーティスト名", "src": "music/your-song.mp3" }
  ]
}
```

- `src` は `public/` からの相対パス（先頭にスラッシュを付けない）
- `artist` は省略可
- 開発サーバなら保存するだけで反映。公開版は `main` に push すると GitHub Pages に配信される
- ページ内のラジオの「曲を追加」からローカルファイルを直接読み込むこともできる（その場では再生できるが保存はされない）
