#!/usr/bin/env zsh

ITEMS_SCRIPT='
  [
    .items[]
    | if (.volumeInfo.industryIdentifiers? // []) | any(.type == "ISBN_10" or .type == "ISBN_13") then
        .volumeInfo
        | (
            ((.industryIdentifiers? // []) | map({ (.type | ascii_downcase): .identifier }) | add)
            + ({ title, subtitle, authors, printType, publisher, publishedDate, description } | del(..|nulls))
          )
      else
        empty
      end
  ]
'

TAG_PREFIX=se/

find attachments -type d -print | while read -r SRC_DIR ; do
    if [ $SRC_DIR != "attachments" ] ; then
        TAG=${SRC_DIR#attachments/}
        echo "## $TAG/"
        find $SRC_DIR -maxdepth 1 -name '*.pdf' -print | while read PDF_FILE ; do
            TITLE=$(basename $PDF_FILE .pdf)

            mkdir -p info/$TAG
            INFO_FILE="info/$TAG/$TITLE.json"

            mkdir -p items/$TAG
            ITEMS_FILE="items/$TAG/$TITLE.json"

            mkdir -p markdown/$TAG
            MARKDOWN_FILE="markdown/$TAG/$TITLE.md"

            if [ ! -f "$INFO_FILE" ] ; then
                echo "   $TITLE"
                TITLE_URLENCODED=$(jq -rn --arg x "$TITLE" '$x|@uri')
                QUERY_URL="https://www.googleapis.com/books/v1/volumes?q=title:$TITLE_URLENCODED"
                curl -fsSL $QUERY_URL > $INFO_FILE        
                rm -f $ITEMS_FILE
            fi

            if [ ! -f "$ITEMS_FILE" ] ; then
                jq $ITEMS_SCRIPT "$INFO_FILE" > "$ITEMS_FILE"
                rm -f $MARKDOWN_FILE
            fi


            if [ ! -f "$MARKDOWN_FILE" ] ; then
                FRONTMATTER=$(jq '.[0] | { title, subtitle, edition, authors, pageCount, publisher, publishedDate, isbn10, isbn13 } | del(..|nulls)' "$ITEMS_FILE" | yq -P -oy)
                DESCRIPTION=$(jq -r '.[0] | .description? // ""' $ITEMS_FILE)
                RELATIVE_PATH=$(realpath --relative-to markdown/$TAG/.. $PDF_FILE)
                (
                    echo "---"
                    echo "tags:"
                    echo "  - type/book"
                    echo "  - process/review"
                    echo "  - $TAG_PREFIX$TAG"
                    echo "$FRONTMATTER"
                    echo "---"
                    echo
                    echo "[[$RELATIVE_PATH|PDF]] [Google](https://books.google.com/books?id=$ISBN_10)"
                    echo
                    echo "$DESCRIPTION"
                ) > "$MARKDOWN_FILE"
            fi
        done
    fi
done
