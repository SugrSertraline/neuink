use crate::{
    attachments, database, discovery, Collection, Library, Paper, SourceSettings, ZoteroError,
};
use rusqlite::{Connection, OptionalExtension};
use std::collections::{BTreeMap, HashMap, HashSet};

pub fn read_library(settings: &SourceSettings) -> Result<Library, ZoteroError> {
    let directory = discovery::normalize_directory(
        settings
            .data_directory
            .as_deref()
            .ok_or(ZoteroError::Directory)?,
    )?;
    let connection = database::snapshot(&directory.join("zotero.sqlite"))?;
    read_snapshot(
        &connection,
        &SourceSettings {
            data_directory: Some(directory),
            ..settings.clone()
        },
    )
    .map_err(|e| match e {
        ZoteroError::Limit => e,
        _ => ZoteroError::Schema,
    })
}

fn read_snapshot(db: &Connection, settings: &SourceSettings) -> Result<Library, ZoteroError> {
    let directory = settings
        .data_directory
        .as_ref()
        .ok_or(ZoteroError::Directory)?;
    let instance: Option<String> = db
        .query_row(
            "SELECT value FROM settings WHERE setting='account' AND key='localUserKey'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| ZoteroError::Schema)?;
    let identity = instance.unwrap_or_else(|| directory.to_string_lossy().to_string());
    let source_id = blake3::hash(identity.as_bytes()).to_hex().to_string();
    let groups: HashMap<i64, String> = rows(db, "SELECT libraryID, name FROM groups", |r| {
        Ok((r.get(0)?, r.get(1)?))
    })?
    .into_iter()
    .collect();
    let mut papers: BTreeMap<i64, Paper> = rows(db, "SELECT i.itemID, i.libraryID, i.key FROM items i JOIN itemTypes t ON t.itemTypeID=i.itemTypeID LEFT JOIN itemAttachments a ON a.itemID=i.itemID WHERE NOT EXISTS (SELECT 1 FROM deletedItems d WHERE d.itemID=i.itemID) AND t.typeName NOT IN ('note','annotation') AND (t.typeName!='attachment' OR (a.parentItemID IS NULL AND a.contentType='application/pdf'))", |r| {
        let item_id = r.get(0)?;
        let library_id = r.get(1)?;
        let key: String = r.get(2)?;
        Ok((item_id, Paper { id: format!("{library_id}:{key}"), key, library_id,
            library_name: groups.get(&library_id).cloned().unwrap_or_else(|| "我的文库".into()),
            title: String::new(), authors: String::new(), year: String::new(), fields: BTreeMap::new(), tags: vec![], collection_ids: vec![], attachments: vec![] }))
    })?.into_iter().collect();
    if papers.len() > 50_000 {
        return Err(ZoteroError::Limit);
    }
    for (id, name, value) in rows(db, "SELECT d.itemID, f.fieldName, v.value FROM itemData d JOIN fields f ON f.fieldID=d.fieldID JOIN itemDataValues v ON v.valueID=d.valueID WHERE f.fieldName IN ('title','date','DOI','url','abstractNote','publicationTitle','volume','issue','pages','ISBN','ISSN','publisher','language')", |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))? {
        let Some(paper) = papers.get_mut(&id) else { continue };
        if value.len() > 256 * 1024 { return Err(ZoteroError::Limit); }
        match name.as_str() {
            "title" => paper.title = value,
            "date" => { paper.year = extract_year(&value); paper.fields.insert("date".into(), value); }
            "abstractNote" => { paper.fields.insert("description".into(), value); }
            "DOI" => { paper.fields.insert("doi".into(), value); }
            "url" => { paper.fields.insert("source_url".into(), value); }
            _ => { paper.fields.insert(name, value); }
        }
    }
    for (id, first, last, role) in rows(db, "SELECT ic.itemID, COALESCE(c.firstName,''), COALESCE(c.lastName,''), ct.creatorType FROM itemCreators ic JOIN creators c ON c.creatorID=ic.creatorID JOIN creatorTypes ct ON ct.creatorTypeID=ic.creatorTypeID ORDER BY ic.itemID, ic.orderIndex", |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)))? {
        if let Some(paper) = papers.get_mut(&id) {
            let name = format!("{first} {last}").trim().to_string();
            if name.is_empty() { continue; }
            let value = if role == "author" { &mut paper.authors }
                else { paper.fields.entry(format!("zotero_{role}")).or_default() };
            if !value.is_empty() { value.push_str("; "); }
            value.push_str(&name);
        }
    }
    for (id, tag) in rows(
        db,
        "SELECT it.itemID, t.name FROM itemTags it JOIN tags t ON t.tagID=it.tagID ORDER BY t.name",
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
    )? {
        if let Some(paper) = papers.get_mut(&id) {
            if !tag.trim().is_empty() && !paper.tags.contains(&tag) {
                paper.tags.push(tag);
            }
        }
    }
    let raw_collections: HashMap<i64, (i64, String, Option<i64>)> = rows(
        db,
        "SELECT collectionID, libraryID, collectionName, parentCollectionID FROM collections",
        |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?, r.get(3)?))),
    )?
    .into_iter()
    .collect();
    let mut collections = Vec::new();
    for (&id, (library_id, name, parent)) in &raw_collections {
        let mut names = vec![name.clone()];
        let mut next = *parent;
        let mut seen = HashSet::from([id]);
        while let Some(parent_id) = next {
            if !seen.insert(parent_id) {
                return Err(ZoteroError::Schema);
            }
            let Some((_, parent_name, ancestor)) = raw_collections.get(&parent_id) else {
                break;
            };
            names.push(parent_name.clone());
            next = *ancestor;
        }
        names.push(
            groups
                .get(library_id)
                .cloned()
                .unwrap_or_else(|| "我的文库".into()),
        );
        names.reverse();
        collections.push(Collection {
            id: id.to_string(),
            name: name.clone(),
            path: names.join(" / "),
            parent_id: parent.map(|v| v.to_string()),
        });
    }
    collections.sort_by(|a, b| a.path.cmp(&b.path));
    for (item_id, collection_id) in rows(
        db,
        "SELECT itemID, collectionID FROM collectionItems",
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
    )? {
        if let Some(paper) = papers.get_mut(&item_id) {
            let mut next = Some(collection_id);
            let mut seen = HashSet::new();
            while let Some(id) = next {
                if !seen.insert(id) {
                    return Err(ZoteroError::Schema);
                }
                if !paper.collection_ids.contains(&id.to_string()) {
                    paper.collection_ids.push(id.to_string());
                }
                next = raw_collections.get(&id).and_then(|c| c.2);
            }
        }
    }
    for (id, parent, key, mode, path) in rows(db, "SELECT a.itemID, a.parentItemID, i.key, a.linkMode, COALESCE(a.path,'') FROM itemAttachments a JOIN items i ON i.itemID=a.itemID WHERE a.contentType='application/pdf' AND NOT EXISTS (SELECT 1 FROM deletedItems d WHERE d.itemID=a.itemID) ORDER BY a.itemID", |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, String>(4)?)))? {
        if let Some(paper) = papers.get_mut(&parent.unwrap_or(id)) {
            paper.attachments.push(attachments::resolve(directory, settings.linked_attachment_directory.as_deref(), key, mode, path));
        }
    }
    let mut papers: Vec<Paper> = papers
        .into_values()
        .map(|mut paper| {
            if paper.title.trim().is_empty() {
                paper.title = paper
                    .attachments
                    .first()
                    .map(|a| a.file_name.clone())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| format!("未命名文献 · {}", paper.key));
            }
            if !paper.authors.is_empty() {
                paper.fields.insert("authors".into(), paper.authors.clone());
            }
            if !paper.year.is_empty() {
                paper.fields.insert("year".into(), paper.year.clone());
            }
            paper.attachments.sort_by_key(|a| !a.available);
            paper
        })
        .collect();
    papers.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(Library {
        source_id,
        data_directory: directory.clone(),
        collections,
        papers,
    })
}

fn rows<T, F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>>(
    db: &Connection,
    sql: &str,
    map: F,
) -> Result<Vec<T>, ZoteroError> {
    let mut statement = db.prepare(sql).map_err(|_| ZoteroError::Schema)?;
    let mapped = statement
        .query_map([], map)
        .map_err(|_| ZoteroError::Schema)?;
    mapped
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ZoteroError::Schema)
}

fn extract_year(date: &str) -> String {
    date.as_bytes()
        .windows(4)
        .find(|w| w.iter().all(u8::is_ascii_digit) && (w[0] == b'1' || w[0] == b'2'))
        .map(|w| String::from_utf8_lossy(w).to_string())
        .unwrap_or_default()
}
