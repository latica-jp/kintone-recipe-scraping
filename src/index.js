(function() {
  'use strict';

  kintone.events.on(['app.record.index.show'], function(event) {
    if (document.getElementById('receive_recipe_button')) return event;

    var input = kintone.app
      .getHeaderMenuSpaceElement()
      .appendChild(new kintoneUIComponent.Text().render());
    input.name = 'recipe_url';
    input.style = 'display: inline-block !important; vertical-align: top; width: 300px';

    var button = kintone.app
      .getHeaderMenuSpaceElement()
      .appendChild(new kintoneUIComponent.Button({text: 'レシピを取得'}).render());
    button.id = 'receive_recipe_button';
    button.onclick = scrapeRecipe;
    button.style = 'display: inline-block !important; vertical-align: top';
    return event;
  });

  function scrapeRecipe() {
    var url = document.querySelector('input[name="recipe_url"]').value;
    if (!url) return;

    var spinner = new Spinner();
    document.body.appendChild(spinner.render());
    spinner.show();

    fetchRecipePage(url)
      .then(function(result) {
        var recipe = parseRecipePage(result[0]);
        return createRecipeRecord(recipe, url);
      })
      .then(function(result) {
        return fetchAndUploadRecipeImages(result);
      })
      .then(function(result) {
        return postRecipeRecord(result);
      })
      .then(function(result) {
        spinner.hide();
        // goto detail page
        var location = window.location.href.match(/^(.*\/)/)[0];
        window.location.href = location + 'show#record=' + result.id;
      })
      .catch(function(error) {
        throw new Error(error);
      });
  }

  function fetchRecipePage(url) {
    return kintone.proxy(url, 'GET', {}, {});
  }

  function parseRecipePage(contents) {
    var $ = cheerio.load(contents);

    var name = $('h1.recipe-title').text();
    var imageUrl = $('#main-photo img').attr('data-large-photo');

    var ingredients = [];
    $('div#ingredients_list div.ingredient').each(function(index, element) {
      if ($(element).find('div.ingredient_name').length > 0) {
        ingredients.push({
          ingredient: $(element)
            .find('span.name')
            .first()
            .text(),
          amount: $(element)
            .find('div.ingredient_quantity')
            .first()
            .text()
        });
      } else {
        var category = $(element)
          .find('div.ingredient_category')
          .first();
        ingredients.push({
          category: $(category).text()
        });
      }
    });

    var steps = [];
    $('div#steps div[class^="step"]').each(function(index, element) {
      var step = $(element)
        .find('p.step_text')
        .first()
        .text();
      var stepImageUrl = $(element)
        .find('img')
        .first()
        .attr('data-large-photo');
      steps.push({step: step, stepImageUrl: stepImageUrl});
    });

    var recipe = cleanLineBreaks({
      name: name,
      imageUrl: imageUrl,
      ingredients: ingredients,
      steps: steps
    });
    return recipe;
  }

  function createRecipeRecord(recipe, url) {
    var ingredients = recipe.ingredients.map(function(ingredient) {
      return {
        value: {
          ingredient: {
            type: 'SINGLE_LINE_TEXT',
            value: ingredient.ingredient || ingredient.category
          },
          ingredientAmount: {
            type: 'SINGLE_LINE_TEXT',
            value: ingredient.amount
          }
        }
      };
    });
    var steps = recipe.steps.map(function(step) {
      return {
        value: {
          step: {type: 'SINGLE_LINE_TEXT', value: step.step},
          // image url should be replaced to file key before post
          stepImage: {type: 'FILE', value: step.stepImageUrl}
        }
      };
    });
    return {
      recipeImage: {
        type: 'FILE',
        value: recipe.imageUrl
      },
      // image url should be replaced to file key before post
      recipeUrl: {value: url},
      recipeName: {value: recipe.name},
      ingredients: {value: ingredients},
      steps: {value: steps}
    };
  }

  function fetchAndUploadRecipeImages(recipeRecord) {
    // collect image urls as [{value: imageUrl}, ...]
    var imageObjs = [];
    if (recipeRecord.recipeImage.value) imageObjs.push(recipeRecord.recipeImage);
    recipeRecord.steps.value.forEach(function(step) {
      if (step.value.stepImage.value) {
        imageObjs.push(step.value.stepImage);
      } else {
        // value must be an blank array if no files
        step.value.stepImage.value = [];
      }
    });
    // fetch and upload all images and set file keys to recipe record
    return imageObjs
      .reduce(function(p, imageObj) {
        return p
          .then(function(response) {
            return fetchDataAsBlob(imageObj.value);
          })
          .then(function(response) {
            return uploadFile(response);
          })
          .then(function(response) {
            // value must be an array of fileKey(s)
            imageObj.value = [{fileKey: response}];
          });
      }, kintone.Promise.resolve())
      .then(function(response) {
        return recipeRecord;
      })
      .catch(function(error) {
        throw new Error(error);
      });
  }

  function postRecipeRecord(record) {
    return kintone
      .api(kintone.api.url('/k/v1/record', true), 'POST', {
        app: kintone.app.getId(),
        record: record
      })
      .then(function(response) {
        return response;
      })
      .catch(function(error) {
        return new Error(error);
      });
  }

  function fetchDataAsBlob(url) {
    return new kintone.Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://pipe-with-cors.latica.now.sh?url=' + encodeURIComponent(url), true);
      xhr.responseType = 'blob';
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.onload = function() {
        if (xhr.status === 200) {
          resolve(xhr.response);
        } else {
          reject(Error('Blob download error:' + xhr.statusText));
        }
      };
      xhr.onerror = function() {
        reject(Error('There was a network error.'));
      };
      xhr.send(null);
    });
  }

  /**
   * https://developer.cybozu.io/hc/ja/articles/201941824
   * https://qiita.com/rex0220/items/ba644c916ff2c46fdd48
   */
  function uploadFile(blob) {
    return new kintone.Promise(function(resolve, reject) {
      var formData = new FormData();
      formData.append('__REQUEST_TOKEN__', kintone.getRequestToken());
      formData.append('file', blob, 'file.jpg');
      var url = kintone.api.url('/k/v1/file', true);
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.onload = function() {
        if (xhr.readyState === 4 && xhr.status === 200) {
          var results = JSON.parse(xhr.response);
          resolve(results.fileKey);
        } else {
          reject(Error('File upload error:' + xhr.statusText));
        }
      };
      xhr.onerror = function() {
        reject(Error('There was a network error.'));
      };
      xhr.send(formData);
    });
  }

  function cleanLineBreaks(obj) {
    return JSON.parse(JSON.stringify(obj).replace(/\\n/g, ''));
  }
})();
